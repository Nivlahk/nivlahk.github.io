#!/usr/bin/env python3
"""seer_compile_server.py -- compile C to SEER assembly for the Soak tester.

POST /compile   body: {"source": "<C code>"}
                reply: {"ok": true, "asm": "<SEER .s>", "log": "..."}
                    or {"ok": false, "stage": "clang|llc|input", "log": "<compiler messages>"}
POST /run       body: {"action": "run|check|lower", "source": "<SEER asm>", "regDepth": 256, "toggles": {...}}
                reply: registers, steps, cycles and errors only -- never machine code.
                Runs seer_run.js (Node) on the private SEER tool page (--seer-tool), so the
                assembler and simulator never ship to the browser.
GET  /health    reply: {"ok": true, "llc": "...", "clang": "..."}

Pipeline (the same three commands used by hand):
  clang --target=riscv64-unknown-elf -O1 -fno-unroll-loops -fno-vectorize
        -fno-slp-vectorize -S -emit-llvm      (riscv64 is only the C front end)
  strip the riscv target lines / cpu attributes from the IR
  reorder functions callee-first (seer_reorder_ll.py; SEER llc needs it)
  llc -mtriple=seer -O1

Standard library only. Defaults to 127.0.0.1 so only your own machine can use it.
Before exposing it on a public host, read "Running on a server" in SEER_COMPILE_README.md.

Usage:
  python3 seer_compile_server.py                       # llc at ~/llvm-build/bin/llc
  python3 seer_compile_server.py --llc /path/to/llc --port 8765
"""
import argparse, json, os, re, shutil, subprocess, tempfile, threading, time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seer_reorder_ll import reorder

MAX_SOURCE = 200_000          # bytes of C accepted per request
RATE_N, RATE_WINDOW = 20, 60  # per client address: at most 20 compiles a minute
BUSY = threading.BoundedSemaphore(2)   # at most 2 compiles at once
_hits = defaultdict(deque); _hits_lock = threading.Lock()

def rate_ok(addr):
    now = time.time()
    with _hits_lock:
        q = _hits[addr]
        while q and now - q[0] > RATE_WINDOW: q.popleft()
        if len(q) >= RATE_N: return False
        q.append(now); return True
TIMEOUT = 30                  # seconds per tool run
# /run is cheaper than a compile but is also called while typing (settings panels), so it gets its own budget
RUN_RATE_N = 120
_run_hits = defaultdict(deque)

def run_rate_ok(addr):
    now = time.time()
    with _hits_lock:
        q = _run_hits[addr]
        while q and now - q[0] > RATE_WINDOW: q.popleft()
        if len(q) >= RUN_RATE_N: return False
        q.append(now); return True
CFLAGS = ['--target=riscv64-unknown-elf', '-O1', '-fno-unroll-loops', '-fno-vectorize',
          '-fno-slp-vectorize', '-ffreestanding', '-nostdlibinc', '-S', '-emit-llvm']
# Only plain header names, e.g. <stdint.h> or "mydefs.h": no paths, so a request
# cannot pull arbitrary files off the machine into the compiler's output.
INCLUDE_OK = re.compile(r'^\s*#\s*include\s*[<"][A-Za-z0-9_]+\.h[>"]\s*$')
INCLUDE_ANY = re.compile(r'^\s*#\s*(include|include_next|import|embed)\b')

def strip_ir(text):
    text = re.sub(r'^target (datalayout|triple).*\n', '', text, flags=re.M)
    return re.sub(r'"(target-cpu|target-features|tune-cpu)"="[^"]*"', '', text)

def compile_c(source, args):
    if len(source.encode('utf-8')) > MAX_SOURCE:
        return {'ok': False, 'stage': 'input', 'log': f'source is larger than {MAX_SOURCE} bytes'}
    for n, line in enumerate(source.splitlines(), 1):
        if INCLUDE_ANY.match(line) and not INCLUDE_OK.match(line):
            return {'ok': False, 'stage': 'input',
                    'log': f'line {n}: only plain header names are allowed, e.g. #include <stdint.h>'}
    d = tempfile.mkdtemp(prefix='seerc_')
    try:
        c, ll, s = (os.path.join(d, 'prog' + e) for e in ('.c', '.ll', '.s'))
        open(c, 'w').write(source)
        # SEER's CN table has 256 slots: every branch target and every function
        # takes one. Inlining copies callee code (and its branch targets) into
        # each caller, so a larger program can fit without inlining and overflow
        # with it. Try normal -O1 first; on CN overflow only, retry with
        # inlining off and say so in the log.
        note = ''
        for extra in ([], ['-fno-inline-functions']):
            r = subprocess.run([args.clang, *CFLAGS, *extra, 'prog.c', '-o', 'prog.ll'], cwd=d,
                               capture_output=True, text=True, timeout=TIMEOUT)
            if r.returncode:
                return {'ok': False, 'stage': 'clang', 'log': r.stderr.replace(d + '/', '')}
            clog = r.stderr
            ir = strip_ir(open(ll).read())      # read fully before reopening for write
            ir, _ = reorder(ir)                 # callees before callers
            open(ll, 'w').write(ir)
            r = subprocess.run([args.llc, '-mtriple=seer', '-O1', 'prog.ll', '-o', 'prog.s'], cwd=d,
                               capture_output=True, text=True, timeout=TIMEOUT)
            if r.returncode == 0:
                break
            if extra or 'connector-node table overflow' not in r.stderr:
                return {'ok': False, 'stage': 'llc', 'log': note + r.stderr.replace(d + '/', '')[-6000:]}
            note = ('note: the program needs more than the 255 CN-table slots at -O1, so it was '
                    'recompiled with -fno-inline-functions.\n')
        return {'ok': True, 'asm': open(s).read(),
                'log': note + (clog + r.stderr).replace(d + '/', '')}
    except subprocess.TimeoutExpired as e:
        return {'ok': False, 'stage': 'timeout', 'log': f'{e.cmd[0]} took longer than {TIMEOUT}s'}
    finally:
        shutil.rmtree(d, ignore_errors=True)

def run_seer(body, args):
    """Hand one /run request to seer_run.js. Always returns a dict, never raises."""
    try:
        r = subprocess.run(['node', args.seer_run_js, args.seer_tool], input=body,
                           capture_output=True, timeout=TIMEOUT)
        return json.loads(r.stdout or b'{"ok": false, "error": "simulator gave no output"}')
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': 'the simulation took too long'}
    except Exception:
        return {'ok': False, 'error': 'simulator unavailable'}

def make_handler(args):
    class H(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', args.allow_origin)
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.end_headers(); self.wfile.write(body)
        def do_OPTIONS(self): self._send(204, {})
        def do_GET(self):
            if self.path.rstrip('/') == '/health':
                return self._send(200, {'ok': True, 'llc': args.llc, 'clang': args.clang})
            self._send(404, {'ok': False, 'log': 'not found'})
        def do_POST(self):
            path = self.path.rstrip('/')
            if path not in ('/compile', '/run'):
                return self._send(404, {'ok': False, 'log': 'not found'})
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_SOURCE * 2:
                return self._send(413, {'ok': False, 'stage': 'input', 'log': 'request too large', 'error': 'request too large'})
            if path == '/run':
                body = self.rfile.read(n) or b'{}'
                addr = self.headers.get('X-Forwarded-For', self.client_address[0]).split(',')[0].strip()
                if not run_rate_ok(addr):
                    return self._send(429, {'ok': False, 'error': f'rate limit: {RUN_RATE_N} runs per minute'})
                if not BUSY.acquire(timeout=TIMEOUT):
                    return self._send(503, {'ok': False, 'error': 'server busy, try again'})
                try:
                    res = run_seer(body, args)
                finally:
                    BUSY.release()
                return self._send(200, res)
            try:
                source = json.loads(self.rfile.read(n) or b'{}').get('source', '')
            except Exception:
                return self._send(400, {'ok': False, 'stage': 'input', 'log': 'body must be JSON {"source": "..."}'})
            addr = self.headers.get('X-Forwarded-For', self.client_address[0]).split(',')[0].strip()
            if not rate_ok(addr):
                return self._send(429, {'ok': False, 'stage': 'input', 'log': f'rate limit: {RATE_N} compiles per minute'})
            if not BUSY.acquire(timeout=TIMEOUT):
                return self._send(503, {'ok': False, 'stage': 'input', 'log': 'server busy, try again'})
            try:
                t0 = time.time(); res = compile_c(source, args); res['ms'] = int((time.time() - t0) * 1000)
            finally:
                BUSY.release()
            self._send(200, res)
        def log_message(self, fmt, *a):
            print(f'{self.address_string()} {fmt % a}')
    return H

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--llc', default=os.path.expanduser('~/llvm-build/bin/llc'))
    ap.add_argument('--clang', default='clang')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--allow-origin', default='*', help='CORS origin allowed to call the service')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--seer-run-js', default=os.path.join(here, 'seer_run.js'), help='seer_run.js, for /run')
    ap.add_argument('--seer-tool', default=os.path.join(here, 'seer_tool.html'),
                    help='your private, full SEER tool page, for /run (never served to anyone)')
    args = ap.parse_args()
    for tool in (args.llc, args.clang):
        if not shutil.which(tool):
            raise SystemExit(f'not found: {tool}')
    if not (shutil.which('node') and os.path.isfile(args.seer_run_js) and os.path.isfile(args.seer_tool)):
        print(f'warning: /run disabled until node, {args.seer_run_js} and {args.seer_tool} all exist')
    print(f'SEER compile service on http://{args.host}:{args.port}  (llc: {args.llc})')
    ThreadingHTTPServer((args.host, args.port), make_handler(args)).serve_forever()

if __name__ == '__main__':
    main()