// Vertex engine from SPOKEN (calvinhancock.com/SPOKEN)
(function () {
// kh-core.js — KH Language Core
const T = Object.freeze({
  NEWLINE: 'NEWLINE', INDENT: 'INDENT', DEDENT: 'DEDENT', EOF: 'EOF',
  NUMBER: 'NUMBER', STRING: 'STRING',
  KEYWORD: 'KEYWORD', IDENTIFIER: 'IDENTIFIER', LAZY: 'LAZY', SELECTOR: 'SELECTOR',
  OP: 'OP', LPAREN: 'LPAREN', RPAREN: 'RPAREN', LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET',
  LBRACE: 'LBRACE', RBRACE: 'RBRACE', COMMA: 'COMMA', COLON: 'COLON', SEMICOLON: 'SEMICOLON', BACKSLASH: 'BACKSLASH',
});

// Updated keyword list per design choices
const KEYWORDS = new Set([
  // Control flow
  'if', 'else', 'while', 'stop', 'jump', 'next',
  // Functions
  'define', 'class', 'give',
  // OOP
  // Data
  'make', 'del', 'take', 'open', 'say', 'print', 'save', 'download',
  // Visual Anchors & Imports
  'pin', 'from',
  // Logic / literals
  'not', 'and', 'or', 'same', 'is', 'yes', 'no', 'none',
  // Iteration
  'in', 'each', 'mostly', 'with', 'as', 'extends',
  // Other / Handling
  'wait', 'note', 'try', 'catch', 'every', 'on', 'bind',
  // Network / AI
  'ask', 'post', 'use', 'get',
  // Google services
  'sheets',
  // Implicit loop variables
  'i', 'ii', 'iii', 'j', 'jj', 'jjj', 'k', 'kk', 'kkk',
]);

const TWO_CHAR_OPS = new Set(['//', '!=', '>=', '<=']);
const ONE_CHAR_OPS = new Set(['+', '-', '/', '*', '%', '^', '=', '<', '>', '.', '&']);

const ESCAPE_MAP = {
  'n': '\n', 't': '\t', 'r': '\r', '\\': '\\',
  "'": "'", '"': '"', '0': '\0', 'a': '\x07',
  'b': '\b', 'f': '\f', 'v': '\v',
};

class Token {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }
  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`;
  }
}

function stripSpokenBlockWords(src) {
  return String(src).split('\n').map((line) => {
    if (/^\s*ok\s*$/.test(line)) return '';
    if (/^\s*note\b/.test(line)) return line;
    return line.replace(/\s+then\s*$/, '');
  }).join('\n');
}

class Lexer {
  constructor(source) {
    this.src = stripSpokenBlockWords(source);
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.indentStack = [0];
    this.pendingIndent = false;
  }

  peek(offset = 0) { return this.src[this.pos + offset] ?? ''; }
  advance() {
    const ch = this.src[this.pos++];
    if (ch === '\n') { this.line++; this.col = 1; }
    else { this.col++; }
    return ch;
  }

  emit(type, value, line, col) {
    this.tokens.push(new Token(type, value, line ?? this.line, col ?? this.col));
  }

  handleIndent() {
    let spaces = 0;
    while (this.peek() === ' ' || this.peek() === '\t') { spaces += this.peek() === '\t' ? 4 : 1; this.advance(); }   // a tab counts as 4 spaces
    if (this.peek() === '\n' || this.peek() === '' || this.peek() === '\r' || this.src.startsWith('note ', this.pos)) {
      return false;
    }
    const current = this.indentStack[this.indentStack.length - 1];
    if (spaces > current) {
      this.indentStack.push(spaces);
      this.emit(T.INDENT, spaces, this.line, 1);
    } else if (spaces < current) {
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > spaces) {
        this.indentStack.pop();
        this.emit(T.DEDENT, spaces, this.line, 1);
      }
    }
    return true;
  }

  readString(quote, startLine, startCol) {
    let value = '';
    while (this.pos < this.src.length) {
      const ch = this.peek();
      if (ch === '\n' || ch === '') break;
      this.advance();
      if (ch === '\\') {
        const esc = this.peek();
        if (esc === 'u') {
          this.advance();
          let hex = '';
          for (let i = 0; i < 4 && /[0-9a-fA-F]/.test(this.peek()); i++) hex += this.advance();
          value += String.fromCharCode(parseInt(hex, 16) || 0);
        } else if (esc === 'x') {
          this.advance();
          let hex = '';
          for (let i = 0; i < 2 && /[0-9a-fA-F]/.test(this.peek()); i++) hex += this.advance();
          value += String.fromCharCode(parseInt(hex, 16) || 0);
        } else {
          const resolved = ESCAPE_MAP[esc];
          if (resolved !== undefined) { this.advance(); value += resolved; }
          else { value += ch; }
        }
      } else if (ch === quote) {
        break;
      } else {
        value += ch;
      }
    }
    this.emit(T.STRING, value, startLine, startCol);
  }

  readMultilineString(quote, startLine, startCol) {
    let value = '';
    while (this.pos < this.src.length) {
      if (this.peek() === quote && this.peek(1) === quote && this.peek(2) === quote) {
        this.advance(); this.advance(); this.advance();
        break;
      }
      const ch = this.peek();
      this.advance();
      if (ch === '\\') {
        const esc = this.peek();
        const resolved = ESCAPE_MAP[esc];
        if (resolved !== undefined) { this.advance(); value += resolved; }
        else { value += ch; }
      } else if (ch === '\n') {
        this.line++; this.col = 1;
        value += '\n';
      } else {
        value += ch;
      }
    }
    this.emit(T.STRING, value, startLine, startCol);
  }

  readNumber(startLine, startCol) {
    let raw = '';
    if (this.peek() === '-') raw += this.advance();
    while (/\d/.test(this.peek())) raw += this.advance();
    if (this.peek() === '.' && /\d/.test(this.peek(1))) {
      raw += this.advance();
      while (/\d/.test(this.peek())) raw += this.advance();
    }
    const value = raw.includes('.') ? parseFloat(raw) : parseInt(raw, 10);
    this.emit(T.NUMBER, value, startLine, startCol);
  }

  readWord(startLine, startCol) {
    let word = '';
    while (/[A-Za-z_\d]/.test(this.peek())) word += this.advance();
    if (word === 'note') {
      while (this.peek() !== '\n' && this.peek() !== '') this.advance();
      return;
    }
    if ((word === 'http' || word === 'https') && this.peek() === ':' && this.peek(1) === '/' && this.peek(2) === '/') {
      this.advance(); this.advance(); this.advance();
      let url = word + '://';
      while (this.pos < this.src.length) {
        const c = this.peek();
        if (c === ' ' || c === '\n' || c === '' || c === '\t') break;
        if (c === ',' || c === ')' || c === ']' || c === '}') break;
        url += this.advance();
      }
      this.emit(T.STRING, url, startLine, startCol);
      return;
    }

    const type = KEYWORDS.has(word) ? T.KEYWORD : T.IDENTIFIER;
    if (this.peek() === '?' && type === T.IDENTIFIER) {
      this.advance();
      this.emit(T.LAZY, word, startLine, startCol);
      return;
    }
    this.emit(type, word, startLine, startCol);
  }

  tokenize() {
    this.pendingIndent = true;
    while (this.pos < this.src.length) {
      if (this.pendingIndent) {
        this.pendingIndent = false;
        const hadContent = this.handleIndent();
        if (!hadContent) {
          while (this.peek() !== '\n' && this.peek() !== '') this.advance();
          if (this.peek() === '\n') { this.advance(); this.pendingIndent = true; }
          continue;
        }
      }

      const ch = this.peek();
      const sLine = this.line;
      const sCol = this.col;

      if (ch === '\n') {
        this.advance();
        this.emit(T.NEWLINE, '\n', sLine, sCol);
        this.pendingIndent = true;
        continue;
      }

      if (ch === ' ') { this.advance(); continue; }

      if (ch === '"' || ch === "'") {
        if (this.peek(1) === ch && this.peek(2) === ch) {
          this.advance(); this.advance(); this.advance();
          this.readMultilineString(ch, sLine, sCol);
        } else {
          this.advance();
          this.readString(ch, sLine, sCol);
        }
        continue;
      }

      if (/\d/.test(ch)) {
        this.readNumber(sLine, sCol);
        continue;
      }
      if (ch === '-' && /\d/.test(this.peek(1))) {
        this.readNumber(sLine, sCol);
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        this.readWord(sLine, sCol);
        continue;
      }

      // #name -- an element on the Screen (#app, #submit-btn)
      if (ch === '#' && /[A-Za-z_]/.test(this.peek(1))) {
        this.advance();
        let name = '';
        while (/[A-Za-z0-9_-]/.test(this.peek()) && !(this.peek() === '-' && !/[A-Za-z0-9_]/.test(this.peek(1)))) name += this.advance();
        this.emit(T.SELECTOR, name, sLine, sCol);
        continue;
      }

      const twoChar = ch + this.peek(1);
      if (TWO_CHAR_OPS.has(twoChar)) {
        this.advance(); this.advance();
        this.emit(T.OP, twoChar, sLine, sCol);
        continue;
      }

      if (ONE_CHAR_OPS.has(ch)) {
        this.advance();
        this.emit(T.OP, ch, sLine, sCol);
        continue;
      }

      switch (ch) {
        case '(': this.advance(); this.emit(T.LPAREN, ch, sLine, sCol); break;
        case ')': this.advance(); this.emit(T.RPAREN, ch, sLine, sCol); break;
        case '[': this.advance(); this.emit(T.LBRACKET, ch, sLine, sCol); break;
        case ']': this.advance(); this.emit(T.RBRACKET, ch, sLine, sCol); break;
        case '{': this.advance(); this.emit(T.LBRACE, ch, sLine, sCol); break;
        case '}': this.advance(); this.emit(T.RBRACE, ch, sLine, sCol); break;
        case ',': this.advance(); this.emit(T.COMMA, ch, sLine, sCol); break;
        case ':': this.advance(); this.emit(T.COLON, ch, sLine, sCol); break;
        case ';': this.advance(); this.emit(T.SEMICOLON, ch, sLine, sCol); break;
        case '\\': this.advance(); this.emit(T.BACKSLASH, ch, sLine, sCol); break;
        default: this.advance(); break;
      }
    }

    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.emit(T.DEDENT, 0, this.line, this.col);
    }
    this.emit(T.EOF, null, this.line, this.col);
    return this.tokens;
  }
}

function lex(source) { return new Lexer(source).tokenize(); }

// ── parser.js ────────────────────────────────────────────────────────────────
const Node = (type, props) => ({ type, ...props });
const ARITH_OPS = new Set(['+', '-', '*', '/', '//', '%', '^']);
const PREC = {
  'or': 1, 'same': 1, 'and': 2, 'not': 3,
  '=': 4, '!=': 4, '<': 4, '>': 4, '<=': 4, '>=': 4, 'is': 4, 'in': 4, 'mostly': 4,
  '+': 5, '-': 5, '&': 5, '*': 6, '/': 6, '//': 6, '%': 6, '^': 7,
};
const RIGHT_ASSOC = new Set(['^']);
const BINARY_OPS = new Set(Object.keys(PREC).filter(k => k !== 'not'));

// ── friendly error helpers ─────────────────────────────────────────────
const OLD_WORDS = {
  init: "'init' isn't needed any more -- put constructor params in the class header (class Dog with name extends Animal) and setup lines straight in the class body", loop: "'loop' is now 'each'", super: "'super' is now 'take' -- write take.method() inside a class", fun: "'fun' is now 'define'", err: "'err' is now 'catch'",
  end: "'end' isn't needed any more -- a block ends when the indentation steps back",
  dot: "'dot' isn't part of Vertex any more", fork: "'fork' isn't part of Vertex any more",
  prev: "'prev' isn't part of Vertex any more", by: "'by' isn't part of Vertex any more",
  key: "'key' isn't part of Vertex any more",
};
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[a.length][b.length];
}
function suggestWord(word) {           // returns a sentence, or null
  if (typeof word !== 'string') return null;
  if (OLD_WORDS[word]) return OLD_WORDS[word] + '.';
  if (word.length < 3) return null;
  let best = null, bd = 3;
  for (const k of KEYWORDS) { if (k.length < 3) continue; const dd = editDistance(word, k); if (dd < bd) { bd = dd; best = k; } }
  return best && best !== word ? `'${word}' isn't a Vertex word. Did you mean '${best}'?` : null;
}
function describeToken(t) {
  switch (t.type) {
    case T.NEWLINE: return 'the end of the line';
    case T.EOF: return 'the end of your code';
    case T.INDENT: return 'extra indentation';
    case T.DEDENT: return 'a line that steps back out';
    case T.STRING: return 'the text "' + t.value + '"';
    case T.NUMBER: return 'the number ' + t.value;
    case T.KEYWORD: return "the word '" + t.value + "'";
    default: return "'" + (t.value ?? t.type) + "'";
  }
}
const NICE_EXPECT = { RPAREN: "a closing ')'", RBRACKET: "a closing ']'", RBRACE: "a closing '}'", COMMA: 'a comma', COLON: "a ':'", IDENTIFIER: 'a name' };

// ── `as` type conversion (the only way to convert: take x as number, make n x as int, x as string) ──
const TYPE_WORDS = { string: 'str', text: 'str', str: 'str', number: 'flt', float: 'flt', flt: 'flt', int: 'int', integer: 'int', whole: 'int', bool: 'bin', boolean: 'bin', bin: 'bin', list: 'list', dict: 'dict' };
const TYPE_LIST_HINT = 'string, number, int, float, bool, list or dict';
const isTypeTok = (t) => !!t && (t.type === T.IDENTIFIER || t.type === T.KEYWORD) && Object.prototype.hasOwnProperty.call(TYPE_WORDS, String(t.value).toLowerCase());
function ivxConvert(interp, conv, value, node) {
  if (FOREIGN.isPy(value)) {
    value = FOREIGN.deep(value);
    if (FOREIGN.isPy(value)) {
      if (conv === 'str') return FOREIGN.repr(value);
      const fn = { int: 'int', flt: 'float', bin: 'bool', list: 'list', dict: 'dict' }[conv];
      if (fn) { try { return FOREIGN.deep(FOREIGN.fromPy(FOREIGN.py.globals.get(fn)(value))); } catch (e) { throw new RuntimeError(FOREIGN.errText(e), node?.line); } }
    }
  } else if (FOREIGN.isJsForeign(value) && conv === 'str') return FOREIGN.repr(value);
  if (conv === 'bin' && typeof value === 'string') return !/^(no|false|0|n|none|)$/i.test(value.trim());
  const out = interp._callBuiltin(conv, [value], node);
  if ((conv === 'int' || conv === 'flt') && Number.isNaN(out)) {
    throw new RuntimeError(`I can't turn ${typeof value === 'string' ? '"' + value + '"' : ivxRepr(value)} into a number.`, node?.line);
  }
  return out;
}

// ── dict methods (a key with the same name wins: {"keys": 1}.keys is 1) ─────
const DICT_METHODS = {
  keys: (d) => [...d.keys()].filter(k => !String(k).startsWith('__')),
  values: (d) => [...d.entries()].filter(([k]) => !String(k).startsWith('__')).map(([, v]) => v),
  length: (d) => [...d.keys()].filter(k => !String(k).startsWith('__')).length,
  isEmpty: (d) => DICT_METHODS.length(d) === 0,
  has: (d, args) => d.has(args[0]),
};
const isPlainDict = (v) => v instanceof Map && !v.has('__class__');

// ── methods that only exist as name.method() on text / lists ─────────────────
const TEXT_METHODS = {
  title: (s) => s.replace(/\b([a-z])/g, (m, c) => c.toUpperCase()),
  capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
  count: (s, a) => { const sub = String(a[0] ?? ''); return sub === '' ? 0 : s.split(sub).length - 1; },
  words: (s) => s.split(/\s+/).filter(Boolean),
  lines: (s) => s.split(/\r?\n/),
  length: (s) => s.length,
  reverse: (s) => [...s].reverse().join(''),
  isEmpty: (s) => s.length === 0,
  repeat: (s, a) => s.repeat(Math.max(0, Math.trunc(Number(a[0] ?? 1)))),
  pad: (s, a) => s.padStart(Number(a[0] ?? 0), String(a[1] ?? ' ')),          // text.pad(width [, fill]) -- pads on the left
  padend: (s, a) => s.padEnd(Number(a[0] ?? 0), String(a[1] ?? ' ')),         // pads on the right
};
const LIST_METHODS = {
  first: (l) => (l.length ? l[0] : NONE),
  last: (l) => (l.length ? l[l.length - 1] : NONE),
  unique: (l) => l.filter((x, i) => l.findIndex(y => ivxEqual(x, y)) === i),
  sum: (l) => l.reduce((t, x) => t + Number(x), 0),
  sort: (l, a) => {
    const out = [...l].sort((x, y) => (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y)));
    return String(a[0] ?? '').toLowerCase().startsWith('desc') ? out.reverse() : out;
  },
  count: (l, a) => l.filter(x => ivxEqual(x, a[0])).length,
  length: (l) => l.length,
  isEmpty: (l) => l.length === 0,
  reverse: (l) => [...l].reverse(),
};

class Parser {
  constructor(source) {
    this.tokens = lex(source);
    this.pos = 0;
    this.errors = [];
    this._impliedSubject = null;
    this._impliedOp = null;
    this._forDepth = 0;

    this._statementParsers = {
      make: () => this.parseMake(),
      del: () => this.parseDel(),
      print: () => this.parseText(),
      say: () => this.parseSay(),
      take: () => this.parseTake(),
      on: () => this.parseOn(),
      bind: () => this.parseBind(),
      open: () => this.parseTake(), // Open reuses take file handling
      save: () => this.parseSave(),
      download: () => this.parseDownload(),
      give: () => this.parseGive(),
      wait: () => this.parseWait(),
      every: () => this.parseEvery(),
      ask: () => this.parseExprStatement(),
      post: () => this.parsePost(),
      use: () => this.parseUseImport(),
      sheets: () => this.parseExprStatement(),
      class: () => this.parseClass(),
      if: () => this.parseIf(),
      each: () => this.parseFor(),
      while: () => this.parseLoop(),
      define: () => this.parseFun(),
      pin: () => {
        const tok = this.advance();
        this.eatNewline();
        return Node('Pin', { line: tok.line });
      },
      stop: () => this.parseStop(),
      jump: () => {
        const tok = this.advance();
        this.eatNewline();
        return Node('Jump', { line: tok.line });
      },
      next: () => {
        const tok = this.advance();
        this.eatNewline();
        return Node('Next', { line: tok.line });
      },
      from: () => this.parseFrom(),
      try: () => this.parseTry(),
    };
  }

  peek(offset = 0) { return this.tokens[this.pos + offset] ?? { type: T.EOF, value: null }; }
  advance() { return this.tokens[this.pos++] ?? { type: T.EOF, value: null }; }
  check(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
  checkKw(value) { return this.check(T.KEYWORD, value); }
  checkOp(value) { return this.check(T.OP, value); }
  eat(type, value) { if (this.check(type, value)) return this.advance(); return null; }
  eatKw(value) { return this.eat(T.KEYWORD, value); }

  expect(type, value, msg) {
    const t = this.eat(type, value);
    if (!t) {
      const cur = this.peek();
      const want = value ? `'${value}'` : (NICE_EXPECT[type] || String(type).toLowerCase());
      const atEnd = cur.type === T.NEWLINE || cur.type === T.EOF;
      const closing = /^(RPAREN|RBRACKET|RBRACE)$/.test(String(type));
      if (closing && atEnd) msg = "A bracket was opened but never closed -- add the missing " + want.replace('a closing ', '') + " at the end of this line.";
      this.error(msg ?? `I expected ${want} here but found ${describeToken(cur)}.` + (atEnd && /RPAREN|RBRACKET|RBRACE/.test(String(type)) ? ' A bracket may never have been closed.' : ''), cur);
    }
    return t;
  }

  error(message, tok) {
    tok = tok ?? this.peek();
    this.errors.push({ line: tok.line, col: tok.col, message });
    this.recover();
  }

  recover() {
    const SAFE = new Set([T.NEWLINE, T.DEDENT, T.EOF]);
    while (!SAFE.has(this.peek().type)) this.advance();
  }

  skipNewlines() { while (this.check(T.NEWLINE)) this.advance(); }

  parseBlock() {
    if (!this.eat(T.INDENT)) {
      this.error('Nothing is indented under this line. Put the lines that belong to it 4 spaces to the right (a block can\'t be empty).');
      return [];
    }
    const stmts = [];
    this.skipNewlines();
    while (!this.check(T.DEDENT) && !this.check(T.EOF)) {
      const s = this.parseStatement();
      if (s) stmts.push(s);
      this.skipNewlines();
    }
    this.eat(T.DEDENT);
    return stmts;
  }

  parseStatement() {
    this.skipNewlines();
    const tok = this.peek();
    if (tok.type === T.EOF || tok.type === T.DEDENT) return null;
    if (tok.type === T.IDENTIFIER && this.peek(1).type === T.KEYWORD && this.peek(1).value === 'as' && isTypeTok(this.peek(2))) {
      this.advance(); this.advance();
      const tt = this.advance();
      this.eatNewline();
      const idn = () => Node('Identifier', { name: tok.value, line: tok.line, col: tok.col });
      return Node('Assign', { name: tok.value, target: idn(), expr: Node('Convert', { expr: idn(), conv: TYPE_WORDS[String(tt.value).toLowerCase()], line: tok.line, col: tok.col }), lazy: false, line: tok.line, col: tok.col });
    }
    if (tok.type === T.IDENTIFIER && this.peek(1).type === T.KEYWORD && this.peek(1).value === 'as' && this.peek(2).type === T.IDENTIFIER) {
      this.advance(); this.advance();                       // <name> as
      const aliasTok = this.advance();                      // <alias>
      this.eatNewline();
      return Node('Assign', { name: aliasTok.value, target: Node('Identifier', { name: aliasTok.value, line: aliasTok.line, col: aliasTok.col }),
        expr: Node('Identifier', { name: tok.value, line: tok.line, col: tok.col }), lazy: false, line: tok.line, col: tok.col });
    }
    if (tok.type === T.KEYWORD) {
      const parseStmt = this._statementParsers[tok.value];
      if (parseStmt) return parseStmt();
      return this.parseExprStatement();
    }
    return this.parseExprStatement();
  }

  eatNewline() { this.eat(T.NEWLINE); }

  parseMake() {
    const tok = this.advance();
    {
      const t1 = this.peek(), t2 = this.peek(1);
      const knownCls = this._classNames || new Set();
      const t3 = this.peek(2);
      const isCls = (x) => x && x.type === T.IDENTIFIER && (knownCls.has(x.value) || /^[A-Z]/.test(x.value));
      const isA = (x) => x && x.type === T.IDENTIFIER && (x.value === 'a' || x.value === 'an');
      const named = t1.type === T.IDENTIFIER && isA(t2) && isCls(t3);
      if ((isA(t1) && isCls(t2)) || named) {
        let varName = null;
        if (named) { varName = this.advance().value; }
        this.advance();
        const clsTok = this.advance();
        if (this.checkKw('as')) {
          this.error(`Name the object first. Write: make ${this.peek(1).value || 'name'} a ${clsTok.value} with ...`, this.peek());
          return null;
        }
        if (varName === null) varName = clsTok.value.charAt(0).toLowerCase() + clsTok.value.slice(1);
        const args = [];
        if (this.checkKw('with')) { this.advance(); do { args.push(this.parseExpr()); } while (this.eat(T.COMMA)); }
        this.eatNewline();
        return Node('Assign', { name: varName, target: Node('Identifier', { name: varName, line: t1.line, col: t1.col }),
          expr: Node('Call', { name: clsTok.value, args, line: clsTok.line, col: clsTok.col }), lazy: false, line: tok.line, col: tok.col });
      }
    }
    const nameTok = this.peek();
    const isLazy = nameTok.type === T.LAZY;
    if (nameTok.type !== T.IDENTIFIER && !isLazy && nameTok.type !== T.SELECTOR) {
      this.error("Expected variable name after 'make'", nameTok);
      return null;
    }
    let target = nameTok.type === T.SELECTOR
      ? Node('Element', { name: this.advance().value, line: nameTok.line, col: nameTok.col })
      : Node('Identifier', { name: this.advance().value, line: nameTok.line, col: nameTok.col });
    if (target.type === 'Element' && !this.checkOp('.')) {
      this.error(`Say which part of #${target.name} to set, e.g. make #${target.name}.text "hello"`, this.peek());
      return null;
    }
    while (this.checkOp('.')) {
      const dot = this.advance();
      const fieldTok = this.peek();
      if (fieldTok.type !== T.IDENTIFIER && fieldTok.type !== T.KEYWORD) {
        this.error("Expected field name after '.'", fieldTok);
        break;
      }
      this.advance();
      target = Node('MemberAccess', { object: target, field: fieldTok.value, line: dot.line, col: dot.col });
    }

    const nextTok = this.peek();
    let expr;
    if (nextTok.type === T.OP && ['+', '-', '*', '/', '//', '%', '^'].includes(nextTok.value)) {
      const impliedLeft = target;
      const op = this.advance().value;
      const right = this.parseExpr();
      expr = Node('BinOp', { op, left: impliedLeft, right, line: tok.line });
    } else {
      expr = this.parseExpr();
    }
    this.eatNewline();
    const name = target.type === 'Identifier' ? target.name : null;
    return Node('Assign', { name, target, expr, lazy: isLazy, line: tok.line, col: tok.col });
  }

  parseDel() {
    const tok = this.advance();
    const nameTok = this.peek();
    if (nameTok.type !== T.IDENTIFIER) {
      this.error("Expected variable name after 'del'", nameTok);
      return null;
    }
    const name = this.advance().value;
    this.eatNewline();
    return Node('Delete', { name, line: tok.line, col: tok.col });
  }

  parseText() {
    const tok = this.advance();
    const expr = this.parseExpr();
    this.eatNewline();
    return Node('Print', { expr, line: tok.line, col: tok.col });
  }

  parseSay() {
    const tok = this.advance();
    const expr = this.parseExpr();
    this.eatNewline();
    return Node('Speak', { expr, line: tok.line, col: tok.col });
  }

  parseTake() {
    if (this.peek(1).type === T.OP && this.peek(1).value === '.') return this.parseExprStatement();   // take.method() = parent call
    const tok = this.advance();
    const nameTok = this.peek();
    if (nameTok.type === T.IDENTIFIER && ['int', 'flt', 'str', 'bin', 'list', 'dict'].includes(nameTok.value) && this.peek(1).type === T.LPAREN) {
      this.error(`Converting is done with 'as' now. Write: take <name> as ${nameTok.value === 'flt' ? 'number' : nameTok.value === 'str' ? 'string' : nameTok.value === 'bin' ? 'bool' : nameTok.value}`, nameTok);
      return null;
    }

    if (nameTok.type !== T.IDENTIFIER) {
      this.error("Expected variable name", nameTok);
      return null;
    }
    const name = this.advance().value;
    if (this.checkKw('as')) {
      this.advance();
      const tt = this.peek();
      if (!isTypeTok(tt)) { this.error(`I don't know the type '${tt.value ?? ''}'. Try: ${TYPE_LIST_HINT}.`, tt); return null; }
      const conv = TYPE_WORDS[String(tt.value).toLowerCase()];
      this.advance();
      this.eatNewline();
      return Node('Take', { name, converter: conv, line: tok.line, col: tok.col });
    }
    if (this.peek().type === T.OP && this.peek().value === '.' ||
      (this.peek().type !== T.NEWLINE && this.peek().type !== T.EOF &&
        /^\.(csv|json|txt|tsv|xml)$/.test('.' + (this.peek().value ?? '')))) {
      let ext = '';
      if (this.peek().value === '.') { this.advance(); ext = this.advance().value ?? ''; }
      else { ext = (this.advance().value ?? '').replace(/^\./, ''); }
      this.eatNewline();
      return Node('TakeFile', { name, ext, line: tok.line, col: tok.col });
    }
    this.eatNewline();
    return Node('Take', { name, converter: null, line: tok.line, col: tok.col });
  }

  parseGive() {
    const tok = this.advance();
    const expr = this.parseExpr();
    this.eatNewline();
    return Node('Give', { expr, line: tok.line, col: tok.col });
  }

  // "#app" or #app -> element name, else null
  _elementName() {
    const t = this.peek();
    if (t.type === T.SELECTOR) { this.advance(); return t.value; }
    if (t.type === T.STRING && /^#[A-Za-z_][\w-]*$/.test(t.value)) { this.advance(); return t.value.slice(1); }
    return null;
  }

  // on click "#submit-btn"      (also: type, change, enter, hover; and 'on key' for the keyboard)
  //     ...block...
  parseOn() {
    const tok = this.advance();
    const evTok = this.peek();
    if (evTok.type !== T.IDENTIFIER && evTok.type !== T.KEYWORD) { this.error("Say which event, e.g. on click \"#submit-btn\"", evTok); return null; }
    const EVENTS = { click: 'click', press: 'click', tap: 'click', type: 'input', input: 'input', typing: 'input', change: 'change', enter: 'enter', hover: 'hover', key: 'key' };
    const event = EVENTS[String(evTok.value).toLowerCase()];
    if (!event) { this.error(`'${evTok.value}' isn't an event I know. Use click, type, change, enter, hover or key`, evTok); return null; }
    this.advance();
    let target = null;
    if (event !== 'key') {
      target = this._elementName();
      if (!target) { this.error(`Say which element, e.g. on ${evTok.value} "#submit-btn"`, this.peek()); return null; }
    }
    this.eatNewline();
    if (!this.check(T.INDENT)) { this.error(`Put what should happen on the indented lines under 'on ${evTok.value}'`, this.peek()); return null; }
    const body = this.parseBlock();
    return Node('On', { event, target, body, line: tok.line, col: tok.col });
  }

  // bind #app.text counter   -- the element keeps showing the value as it changes
  parseBind() {
    const tok = this.advance();
    if (this.peek().type !== T.SELECTOR && !(this.peek().type === T.STRING && /^#/.test(this.peek().value))) {
      this.error("bind needs an element, e.g. bind #app.text counter", this.peek());
      return null;
    }
    let target = this.parsePrimary();
    if (target && target.type === 'Element') target = Node('MemberAccess', { object: target, field: 'text', line: target.line, col: target.col });
    if (!target || target.type !== 'MemberAccess' || target.object.type !== 'Element') {
      this.error("bind needs an element and what to show, e.g. bind #app.text counter", tok);
      return null;
    }
    const expr = this.parseExpr();
    if (!expr) { this.error("Say what to show, e.g. bind #app.text counter", this.peek()); return null; }
    this.eatNewline();
    return Node('Bind', { target, expr, line: tok.line, col: tok.col });
  }

  _timeUnit() {
    const UNITS = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
                    min: 60000, mins: 60000, minute: 60000, minutes: 60000 };
    const t = this.peek();
    if ((t.type === T.IDENTIFIER || t.type === T.KEYWORD) && UNITS[String(t.value).toLowerCase()]) { this.advance(); return UNITS[String(t.value).toLowerCase()]; }
    return null;
  }

  parseEvery() {
    const tok = this.advance();
    return this._parseTrigger(tok, true);
  }

  parseWait() {
    const tok = this.advance();
    const next = this.peek();
    if (next.type === T.KEYWORD && next.value === 'every') {
      this.advance();
      return this._parseTrigger(tok, true);
    }
    if (next.type === T.IDENTIFIER && this.peek(1).type === T.OP && this.peek(1).value === '=') {
      const name = this.advance().value;
      this.advance();
      const value = this.parseExpr();
      this.eatNewline();
      return Node('Wait', {
        expr: null,
        condition: Node('BinOp', { op: '=', left: Node('Identifier', { name }), right: value }),
        line: tok.line, col: tok.col
      });
    }
    return this._parseTrigger(tok, false);
  }

  _parseTrigger(tok, recurring) {
    const next = this.peek();
    if ((next.type === T.KEYWORD || next.type === T.IDENTIFIER) && next.value === 'email') {
      this.advance();
      const filters = {};
      if (this.check(T.LPAREN)) {
        this.advance();
        while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
          const keyTok = this.advance();
          const key = keyTok.value;
          if (this.check(T.OP) && this.peek().value === '=') this.advance();
          filters[key] = this.parsePrimary();
          this.eat(T.COMMA);
        }
        this.expect(T.RPAREN, undefined, "Expected ')' after email filters");
      }
      let source = null;
      if (this.checkKw('from')) { this.advance(); source = this.parseExpr(); }
      this.eatNewline();
      const body = this.check(T.INDENT) ? this.parseBlock() : [];
      return Node('WaitBlock', { trigger: 'email', source, filters, body, recurring, line: tok.line, col: tok.col });
    }

    if ((next.type === T.KEYWORD || next.type === T.IDENTIFIER) && next.value === 'sheets') {
      this.advance();
      const name = this.parseExpr();
      let event = 'row added';
      if (this.checkKw('from')) {
        this.advance();
        const parts = [];
        while (!this.check(T.NEWLINE) && !this.check(T.EOF) && !this.check(T.DEDENT)) {
          parts.push(this.advance().value ?? '');
        }
        if (parts.length) event = parts.join(' ');
      }
      this.eatNewline();
      const body = this.check(T.INDENT) ? this.parseBlock() : [];
      return Node('WaitBlock', { trigger: 'sheets', source: name, event, body, recurring, line: tok.line, col: tok.col });
    }

    if ((next.type === T.KEYWORD || next.type === T.IDENTIFIER) && next.value === 'time') {
      this.advance();
      const source = this.parseExpr();
      this.eatNewline();
      const body = this.check(T.INDENT) ? this.parseBlock() : [];
      return Node('WaitBlock', { trigger: 'time', source, body, recurring, line: tok.line, col: tok.col });
    }

    if ((next.type === T.KEYWORD || next.type === T.IDENTIFIER) && next.value === 'http') {
      this.advance();
      this.eatNewline();
      const body = this.check(T.INDENT) ? this.parseBlock() : [];
      return Node('WaitBlock', { trigger: 'http', source: null, body, recurring, line: tok.line, col: tok.col });
    }

    const expr = this.parseExpr();
    const unitMs = this._timeUnit();
    this.eatNewline();
    if (recurring && (unitMs || this.check(T.INDENT))) {
      // every 1 second  -- repeats the indented lines while the program runs
      if (!this.check(T.INDENT)) { this.error("Put what should repeat on the indented lines under 'every'", this.peek()); return null; }
      const body = this.parseBlock();
      return Node('Every', { expr, unitMs: unitMs || 1000, body, line: tok.line, col: tok.col });
    }
    return Node('Wait', { expr, unitMs, condition: null, line: tok.line, col: tok.col });
  }

  parsePost() {
    const tok = this.advance();
    const url = this.parseExpr();
    const body = this.parseExpr();
    let credential = null;
    if (this.checkKw('use')) { this.advance(); credential = this.parseExpr(); }
    this.eatNewline();
    return Node('Post', { url, body, credential, line: tok.line, col: tok.col });
  }

  parseUseImport() {
    const tok = this.advance();
    if (this.peek().type === T.IDENTIFIER && this.peek().value === 'cred') {
      this.advance();
      const name = this.parseExpr();
      this.eatNewline();
      return Node('UseCred', { name, line: tok.line, col: tok.col });
    }
    const atEnd = () => this.check(T.NEWLINE) || this.check(T.EOF) || this.check(T.DEDENT);
    if (atEnd()) {
      this.error("Say what to use. Write: use python numpy   or   use js lodash   or   use \"https://.../file.vx\"", this.peek());
      return null;
    }
    const LANGS = { python: 'python', py: 'python', js: 'js', javascript: 'js', npm: 'js', pypi: 'python' };
    let lang = null;
    const first = this.peek();
    if ((first.type === T.IDENTIFIER || first.type === T.KEYWORD) && LANGS[String(first.value).toLowerCase()] && !(this.peek(1).type === T.NEWLINE || this.peek(1).type === T.EOF)) {
      lang = LANGS[String(this.advance().value).toLowerCase()];
    }
    let spec = '';
    let isString = false;
    if (this.check(T.STRING)) { spec = this.advance().value; isString = true; }
    else {
      // package names can hold - . / @ (date-fns, os.path, @turf/turf): glue the raw tokens back together
      while (!atEnd() && !this.checkKw('as')) spec += String(this.advance().value ?? '');
    }
    let alias = null;
    if (this.checkKw('as')) {
      this.advance();
      const at = this.peek();
      if (at.type !== T.IDENTIFIER) { this.error("Expected a name after 'as'", at); return null; }
      alias = this.advance().value;
    }
    if (!spec) { this.error("Say which package to use, e.g. use python numpy", this.peek()); return null; }
    const isUrl = /^https?:\/\//i.test(spec);
    if (!lang && !isUrl) {
      this.error(`Say which language '${spec}' comes from. Write: use python ${spec}   or   use js ${spec}`, first);
      return null;
    }
    this.eatNewline();
    return Node('Library', { lang, spec, alias, isUrl, line: tok.line, col: tok.col });
  }

  _parseSavePayload(target, line, col) {
    if (this.check(T.NEWLINE) || this.check(T.EOF) || this.check(T.DEDENT)) {
      this.error("Expected value or filename after 'save'", this.peek());
      return null;
    }

    const first = this.parseExpr();
    if (!first) {
      this.error("Expected value or filename after 'save'", this.peek());
      return null;
    }

    if (first.type === 'Identifier' && this.checkOp('.')) {
      const filenameExpr = this._parseBareFilename(first.name, first.line, first.col);
      if (!filenameExpr) return null;
      this.eatNewline();
      return Node('Save', { valueExpr: null, filenameExpr, target, line, col });
    }

    if (first.type === 'StringLit' &&
      !this.check(T.NEWLINE) && !this.check(T.EOF) && !this.check(T.DEDENT)) {
      const valueExpr = this._parseSaveFilenameExpr();
      this.eatNewline();
      return Node('Save', { valueExpr, filenameExpr: first, target, line, col });
    }
    if (first.type === 'StringLit') {
      this.eatNewline();
      return Node('Save', { valueExpr: null, filenameExpr: first, target, line, col });
    }

    if (first.type === 'Identifier' &&
      (this.check(T.NEWLINE) || this.check(T.EOF) || this.check(T.DEDENT))) {
      const autoFilename = Node('StringLit', { value: first.name, line: first.line, col: first.col });
      this.eatNewline();
      return Node('Save', { valueExpr: first, filenameExpr: autoFilename, autoName: true, target, line, col });
    }

    let valueExpr = first;
    const filenameExpr = this._parseSaveFilenameExpr();
    if (!filenameExpr) {
      this.error("Expected filename after value in 'save'", this.peek());
      return null;
    }

    this.eatNewline();
    return Node('Save', { valueExpr, filenameExpr, target, line, col });
  }

  parseSave() {
    const tok = this.advance();
    return this._parseSavePayload('drive', tok.line, tok.col);
  }

  _parseBareFilename(initial, line, col) {
    let name = initial;
    while (this.checkOp('.')) {
      this.advance();
      const part = this.peek();
      if ([T.IDENTIFIER, T.KEYWORD, T.NUMBER].includes(part.type)) {
        name += '.' + String(this.advance().value ?? '');
      } else {
        this.error("Expected filename segment after '.'", part);
        return null;
      }
    }
    return Node('StringLit', { value: name, line, col });
  }

  _parseSaveFilenameExpr() {
    const tok = this.peek();
    if (tok.type === T.STRING) {
      this.advance();
      return Node('StringLit', { value: tok.value, line: tok.line, col: tok.col });
    }
    if (tok.type === T.IDENTIFIER) {
      const id = this.advance();
      return this._parseBareFilename(id.value, id.line, id.col);
    }
    return this.parseExpr();
  }

  parseDownload() {
    const tok = this.advance();
    return this._parseSavePayload('local', tok.line, tok.col);
  }

  parseIf() {
    const tok = this.advance();
    this._impliedSubject = null;
    this._impliedOp = null;
    const condition = this.parseCondition();
    this.eatNewline();
    const body = this.parseBlock();
    let else_ = null;

    this.skipNewlines();
    if (this.checkKw('else')) {
      this.advance();
      if (this.checkKw('if')) {
        else_ = [this.parseIf()];
      } else if (this.checkKw('stop')) {
        else_ = [this.parseStop()];
      } else if (this.check(T.NEWLINE)) {
        this.eatNewline();
        else_ = this.parseBlock();
      } else if (this.check(T.INDENT)) {
        else_ = this.parseBlock();
      } else {
        const s = this.parseStatement();
        if (s) {
          this.skipNewlines();
          if (this.check(T.INDENT)) {
            const blockStmts = this.parseBlock();
            else_ = [s, ...blockStmts];
          } else {
            else_ = [s];
          }
        }
      }
    }

    return Node('If', { condition, body, else_, line: tok.line, col: tok.col });
  }

  parseFor() {
    const tok = this.advance();
    const varNames = [['i', 'ii'], ['j', 'jj'], ['k', 'kk']];
    const depth = Math.min(this._forDepth, varNames.length - 1);
    const [primary, secondary] = varNames[depth];

    let target = null;
    let targetExpr = null;
    let iterVar = primary, iterVar2 = secondary;
    const first = this.peek();
    const second = this.peek(1);
    if (first.type === T.IDENTIFIER && second.type === T.KEYWORD && second.value === 'in') {
      this.advance(); this.advance();          // name, 'in'
      iterVar = first.value;
      targetExpr = this.parseExpr();           // list literal, call, member access, identifier...
    } else {
      if (first.type === T.NEWLINE || first.type === T.EOF || first.type === T.INDENT) {
        this.error("Expected a count or something to loop over after 'each'", first);
        return null;
      }
      targetExpr = this.parseExpr();           // 3, n, 2 * 4, items, range(8)...
    }

    this.eatNewline();
    this._forDepth++;
    const body = this.parseBlock();
    this._forDepth--;

    return Node('For', {
      target, targetExpr, iterVar, iterVar2,
      line: tok.line, col: tok.col,
      body
    });
  }

  parseLoop() {
    const tok = this.advance();
    this._impliedSubject = null;
    this._impliedOp = null;
    const condition = this.parseCondition();
    this.eatNewline();
    const body = this.parseBlock();
    return Node('Loop', { condition, body, line: tok.line, col: tok.col });
  }

  parseFun() {
    const tok = this.advance(); // eat 'define'
    const nameTok = this.peek();
    if (nameTok.type !== T.IDENTIFIER) {
      this.error("Expected function name after 'define'", nameTok);
      return null;
    }
    const name = this.advance().value;

    let params = [];
    if (this.checkKw('with')) { this.advance(); params = this._parseParamsAfterLparen(false); }
    else if (this.check(T.LPAREN)) {
      this.error(`Parameters use 'with' now. Write: define ${name} with <names>   (or just: define ${name}   when it takes none)`, this.peek());
      return null;
    }

    this.eatNewline();
    const body = this.check(T.INDENT) ? this.parseBlock() : [];
    return Node('Fun', { name, params, body, line: tok.line, col: tok.col });
  }

  parseTry() {
    const tok = this.advance();
    this.eatNewline();
    const body = this.parseBlock();

    let errVar = 'err';
    let errBody = [];

    this.skipNewlines();
    if (this.checkKw('catch')) {
      this.advance(); // eat 'catch'
      if (this.peek().type === T.IDENTIFIER) {
        errVar = this.advance().value;
      }
      this.eatNewline();
      errBody = this.parseBlock();
    }

    return Node('Try', { body, errVar, errBody, line: tok.line, col: tok.col });
  }

  _parseParamsAfterLparen(paren = true) {
    const params = [];
    while (!this.check(T.RPAREN) && !this.check(T.EOF) && !(!paren && this.check(T.NEWLINE))) {
      const p = this.peek();
      if (p.type !== T.IDENTIFIER && p.type !== T.LAZY) {
        this.error('Expected parameter name', p); break;
      }
      const isLazy = p.type === T.LAZY;
      const paramName = this.advance().value;
      let defaultExpr = null;
      let transformOp = null;
      let transformRight = null;
      if (isLazy) {
        const next = this.peek();
        if (next.type === T.OP && ARITH_OPS.has(next.value)) {
          transformOp = this.advance().value;
          transformRight = this.parseExpr();
        } else if (next.type !== T.COMMA && next.type !== T.RPAREN && next.type !== T.EOF && next.type !== T.NEWLINE) {
          defaultExpr = this.parseExpr();
          const after = this.peek();
          if (after.type === T.OP && ARITH_OPS.has(after.value)) {
            transformOp = this.advance().value;
            transformRight = this.parseExpr();
          }
        }
      } else {
        const next = this.peek();
        if (next.type === T.OP && ARITH_OPS.has(next.value)) {
          transformOp = this.advance().value;
          transformRight = this.parseExpr();
        }
      }
      params.push({ name: paramName, lazy: isLazy, defaultExpr, transformOp, transformRight });
      if (!this.eat(T.COMMA)) break;
    }
    if (paren) this.expect(T.RPAREN, undefined, "Expected ')' after parameters");
    return params;
  }

  parseClass() {
    const tok = this.advance();
    const nameTok = this.peek();
    if (nameTok.type !== T.IDENTIFIER) {
      this.error("Expected class name after 'class'", nameTok);
      return null;
    }
    const name = this.advance().value;
    const known = (this._classNames = this._classNames || new Set());

    // Header: class Dog with breed extends Animal   (either order; both parts optional)
    let superclass = null;
    let headerParams = null;
    if (this.check(T.LPAREN)) {
      this.error(`Class headers don't use parentheses. Write: class ${name} with <fields> extends <Parent>`, this.peek());
      return null;
    }
    while (true) {
      if (this.checkKw('with')) {
        const wt = this.advance();
        if (headerParams !== null) this.error("Class header already has a 'with' list", wt);
        headerParams = this._parseParamsAfterLparen(false);
        continue;
      }
      if (this.checkKw('extends')) {
        const et = this.advance();
        const pt = this.peek();
        if (pt.type !== T.IDENTIFIER) { this.error("Expected a class name after 'extends'", pt); return null; }
        if (superclass !== null) this.error("A class can only extend one parent", et);
        this.advance();
        superclass = { name: pt.value, line: pt.line, col: pt.col };
        continue;
      }
      break;
    }
    known.add(name);

    this.eatNewline();
    const body = this.check(T.INDENT) ? this.parseBlock() : [];
    if (headerParams !== null) {
      // constructor params come only from the header (class Dog with name, breed); stored under an internal name
      body.unshift(Node('Fun', { name: '__init__', params: headerParams, body: [], extendParent: !!superclass, line: tok.line, col: tok.col }));
    }
    return Node('Class', { name, superclass, body, line: tok.line, col: tok.col });
  }

  parseStop() {
    const tok = this.advance(); // eat 'stop'
    let stmt = null;
    if (!this.check(T.NEWLINE) && !this.check(T.EOF) && !this.check(T.DEDENT)) {
      stmt = this.parseStatement();
    } else {
      this.eatNewline();
    }
    return Node('Stop', { stmt, line: tok.line, col: tok.col });
  }

  parseFrom() {
    const tok = this.advance();
    if (this.check(T.STRING)) {
      const urlTok = this.advance();
      const url = urlTok.value;
      const names = [];
      if (this.checkKw('use')) {
        this.advance();
        while (!this.check(T.NEWLINE) && !this.check(T.EOF)) {
          if (this.check(T.IDENTIFIER)) names.push(this.advance().value);
          this.eat(T.COMMA);
        }
      }
      this.eatNewline();
      return Node('Import', { url, names, line: tok.line, col: tok.col });
    }

    const pathParts = [];
    let via = null;
    while (!this.check(T.NEWLINE) && !this.check(T.EOF)) {
      if (this.checkKw('from')) {
        this.advance();
        const viaParts = [];
        while (!this.check(T.NEWLINE) && !this.check(T.EOF)) {
          viaParts.push(this.advance().value ?? '');
        }
        via = viaParts.join(' ');
        break;
      }
      pathParts.push(this.advance().value ?? '');
    }
    this.eatNewline();
    return Node('Import', { path: pathParts.join(' '), via, line: tok.line, col: tok.col });
  }

  parseExprStatement() {
    const expr = this.parseExpr();
    this.eatNewline();
    return Node('ExprStatement', { expr, line: expr?.line });
  }

  parseCondition() { return this.parseConditionExpr(); }

  parseConditionExpr() {
    let left = this.parseConditionClause();
    while (true) {
      if (this.checkKw('not')) {
        const next = this.peek(1);
        if (next && next.type === T.KEYWORD && ['and', 'or', 'same'].includes(next.value)) {
          this.advance();
          const binOp = this.advance().value;
          const op = binOp === 'and' ? 'nand' : binOp === 'or' ? 'nor' : 'xor';
          const right = this.parseConditionClause();
          left = Node('BinOp', { op, left, right, line: left?.line });
          continue;
        }
      }
      if (this.checkKw('and') || this.checkKw('or') || this.checkKw('same')) {
        const op = this.advance().value;
        const right = this.parseConditionClause();
        left = Node('BinOp', { op, left, right, line: left?.line });
        continue;
      }
      break;
    }
    return left;
  }

  parseConditionClause() {
    if (this.checkKw('not')) {
      const next = this.peek(1);
      const isCompound = next && next.type === T.KEYWORD && ['and', 'or', 'same', 'in'].includes(next.value);
      if (!isCompound) {
        const tok = this.advance();
        const operand = this.parseConditionClause();
        return Node('UnaryOp', { op: 'not', operand, line: tok.line, col: tok.col });
      }
    }

    const tok = this.peek();
    const isCompOp = t => {
      if (!t) return false;
      if (t.type === T.OP && ['=', '!=', '<', '>', '<=', '>='].includes(t.value)) return true;
      if (t.type === T.KEYWORD && ['is', 'in', 'mostly'].includes(t.value)) return true;
      if (t.type === T.KEYWORD && t.value === 'not') {
        const next = this.peek(1);
        return next && next.type === T.KEYWORD && next.value === 'in';
      }
      return false;
    };

    const parseOp = () => {
      const t = this.advance();
      if (t.value === 'not') {
        this.advance();
        return 'not in';
      }
      return t.value;
    };

    const isArithOp = t => t && t.type === T.OP && ['+', '-', '*', '/', '//', '%', '^'].includes(t.value);

    if (isCompOp(tok)) {
      const op = parseOp();
      const right = this.parseExpr(4);
      const left = this._impliedSubject ?? Node('Identifier', { name: '?', line: tok.line });
      this._impliedOp = op;
      return Node('BinOp', { op, left, right, line: tok.line });
    } else if (isArithOp(tok) && this._impliedSubject) {
      const arithOp = this.advance().value;
      const arithRight = this.parseExpr(4);
      const arithNode = Node('BinOp', { op: arithOp, left: this._impliedSubject, right: arithRight, line: tok.line });
      if (isCompOp(this.peek())) {
        const op = parseOp();
        const right = this.parseExpr(4);
        this._impliedOp = op;
        return Node('BinOp', { op, left: arithNode, right, line: tok.line });
      }
      return arithNode;
    } else {
      const left = this.parseExpr(4);
      if (isCompOp(this.peek())) {
        const op = parseOp();
        const right = this.parseExpr(4);
        if (!this._impliedSubject) {
            let subj = left;
            while (subj && subj.type === 'BinOp') subj = subj.left;
            this._impliedSubject = subj;
        }
        this._impliedOp = op;
        return Node('BinOp', { op, left, right, line: left?.line });
      } else if (this._impliedSubject && this._impliedOp && !(left && ((left.type === 'BinOp' && ['=', '!=', '<', '>', '<=', '>=', 'is', 'same', 'in', 'not in', 'mostly', 'and', 'or'].includes(left.op)) || (left.type === 'Logical') || (left.type === 'UnaryOp' && left.op === 'not')))) {
        // shorthand like `if x is 1 or 2`; a full condition such as (b is 5) stands on its own
        return Node('BinOp', { op: this._impliedOp, left: this._impliedSubject, right: left, line: tok.line });
      } else {
        return left;
      }
    }
  }

  parseExpr(minPrec = 0) { return this._parseExprCore(minPrec); }

  _parseExprCore(minPrec = 0) {
    let left = this.parseUnary();
    while (true) {
      const tok = this.peek();
      const op = tok.value;
      const prec = PREC[op];
      if (tok.type === T.OP && op === '&') {
        this.error("Join text with + now:  \"a\" + b", tok);
        this.advance();
        break;
      }
      if (prec === undefined || prec <= minPrec) break;
      if (!BINARY_OPS.has(op)) break;
      if (tok.type !== T.OP && tok.type !== T.KEYWORD) break;
      this.advance();
      const nextMinPrec = RIGHT_ASSOC.has(op) ? prec - 1 : prec;
      const right = this.parseExpr(nextMinPrec);
      left = Node('BinOp', { op, left, right, line: left?.line });
    }
    return left;
  }

  parseUnary() {
    if (this.checkKw('not')) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return Node('UnaryOp', { op: 'not', operand, line: tok.line, col: tok.col });
    }
    return this.parsePrimary();
  }

  parsePostfix(base) {
    let expr = base;
    while (true) {
      if (this.checkKw('as') && isTypeTok(this.peek(1))) {      // x as number binds tightly: x as int + 1 is (x as int) + 1
        const at = this.advance();
        const tt = this.advance();
        expr = Node('Convert', { expr, conv: TYPE_WORDS[String(tt.value).toLowerCase()], line: at.line, col: at.col });
        continue;
      }
      if (this.check(T.LBRACKET)) {
        expr = this.parseIndexAccess(expr);
        continue;
      }
      if (this.checkOp('.')) {
        const dot = this.advance();
        const fieldTok = this.peek();
        if (fieldTok.type !== T.IDENTIFIER && fieldTok.type !== T.KEYWORD) {
          this.error("Expected field name after '.'", fieldTok);
          break;
        }
        this.advance();
        expr = Node('MemberAccess', { object: expr, field: fieldTok.value, line: dot.line, col: dot.col });
        continue;
      }
      if (this.check(T.LPAREN)) {
        const lp = this.advance();
        const args = [];
        while (!this.check(T.RPAREN) && !this.check(T.EOF)) {
          const arg = this.parseExpr();
          if (arg) args.push(arg);
          if (!this.eat(T.COMMA)) break;
        }
        this.expect(T.RPAREN, undefined, "Expected ')' after arguments");
        expr = expr.type === 'Identifier'
          ? Node('Call', { name: expr.name, args, line: expr.line, col: expr.col })
          : Node('Invoke', { callee: expr, args, line: lp.line, col: lp.col });
        continue;
      }
      break;
    }
    return expr;
  }

  parseIndexAccess(target) {
    const lbr = this.expect(T.LBRACKET, undefined, "Expected '['");
    if (!lbr) return target;
    const isRowTerminator = () => this.check(T.COMMA) || this.check(T.RBRACKET);
    const isColTerminator = () => this.check(T.RBRACKET);
    const rowSpec = this._parseIndexSpec(isRowTerminator);
    const hasComma = this.eat(T.COMMA) !== null;
    const colSpec = hasComma ? this._parseIndexSpec(isColTerminator) : this._omittedIndexSpec();
    this.expect(T.RBRACKET, undefined, "Expected ']' after index");
    return Node('IndexAccess', { target, rowSpec, colSpec, hasComma, line: lbr.line, colPos: lbr.col });
  }

  _omittedIndexSpec() {
    return { omitted: true, isSlice: false, start: null, end: null, expr: null };
  }

  _parseIndexAtom() {
    const a = this.peek();
    const b = this.peek(1);
    if (a.type === T.IDENTIFIER && b.type === T.NUMBER && Number.isInteger(b.value) && b.value >= 0) {
      this.advance(); this.advance();
      return Node('StringLit', { value: `${a.value}${b.value}`, line: a.line, col: a.col });
    }
    if (a.type === T.IDENTIFIER && /^[A-Za-z]+\d+$/.test(a.value)) {
      this.advance();
      return Node('StringLit', { value: a.value, line: a.line, col: a.col });
    }
    return this.parseExpr();
  }

  _parseIndexSpec(isTerminator) {
    if (isTerminator()) return this._omittedIndexSpec();
    let start = null, end = null, isSlice = false;
    if (!this.check(T.COLON)) start = this._parseIndexAtom();
    if (this.eat(T.COLON)) {
      isSlice = true;
      if (!isTerminator()) end = this._parseIndexAtom();
    }
    return { omitted: false, isSlice, start, end, expr: isSlice ? null : start };
  }

  parsePrimary() {
    const tok = this.peek();
    if (tok.type === T.SELECTOR) {
      this.advance();
      return this.parsePostfix(Node('Element', { name: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && tok.value === 'take') {
      const n = this.peek(1);
      if (n.type === T.SELECTOR || (n.type === T.STRING && /^#[A-Za-z_][\w-]*$/.test(n.value))) {
        const nm = n.type === T.SELECTOR ? n.value : n.value.slice(1);
        this.error(`Read what's typed in a box with its text:  #${nm}.text`, tok);
        this.advance(); this.advance();
        return null;
      }
    }
    if (tok.type === T.NUMBER) {
      this.advance();
      return this.parsePostfix(Node('NumberLit', { value: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.STRING) {
      this.advance();
      return this.parsePostfix(Node('StringLit', { value: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && ['yes', 'no', 'none'].includes(tok.value)) {
      this.advance();
      const value = tok.value === 'yes' ? true : tok.value === 'no' ? false : null;
      return this.parsePostfix(Node('BoolLit', { value, raw: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.LBRACKET) return this.parsePostfix(this.parseList());
    if (tok.type === T.LBRACE) return this.parsePostfix(this.parseDict());
    if (tok.type === T.LPAREN) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(T.RPAREN, undefined, "Expected ')'");
      return this.parsePostfix(expr);
    }
    if (tok.type === T.IDENTIFIER && tok.value === 'super') {
      this.error(OLD_WORDS.super, tok);
      this.advance();
      return null;
    }
    if (tok.type === T.IDENTIFIER) {
      this.advance();
      return this.parsePostfix(Node('Identifier', { name: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && tok.value === 'take' && this.peek(1).type === T.OP && this.peek(1).value === '.') {
      this.advance();
      return this.parsePostfix(Node('Super', { line: tok.line, col: tok.col }));
    }
    if (tok.type === T.LAZY) {
      this.advance();
      return this.parsePostfix(Node('LazyDecl', { name: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && ['i', 'ii', 'iii', 'j', 'jj', 'jjj', 'k', 'kk', 'kkk'].includes(tok.value)) {
      this.advance();
      return this.parsePostfix(Node('Identifier', { name: tok.value, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && tok.value === 'ask') {
      this.advance();
      const modelTok = this.peek();
      let model = 'chatgpt';
      if (modelTok.type === T.IDENTIFIER || modelTok.type === T.KEYWORD) model = this.advance().value;
      else if (modelTok.type === T.STRING) model = 'local';
      const prompt = this.parseExpr();
      let credential = null;
      if (this.checkKw('use')) { this.advance(); credential = this.parseExpr(); }
      return this.parsePostfix(Node('Ask', { model, prompt, credential, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && tok.value === 'sheets') {
      this.advance();
      const name = this.parseExpr();
      return this.parsePostfix(Node('SheetsOpen', { name, line: tok.line, col: tok.col }));
    }
    if (tok.type === T.KEYWORD && tok.value === 'get') {
      this.advance();
      const url = this.parseExpr();
      let params = null;
      if (this.check(T.LBRACE)) params = this.parseDict();
      return this.parsePostfix(Node('Get', { url, params, line: tok.line, col: tok.col }));
    }
    {
      const prevTok = this.tokens && this.pos > 0 ? this.tokens[this.pos - 1] : null;
      let msg;
      let lineStart = null;
      if (tok.type === T.INDENT && this.tokens) {
        let i = this.pos - 1;
        if (this.tokens[i] && this.tokens[i].type === T.NEWLINE) i--;     // the INDENT sits after the end of the line it belongs to
        while (i > 0 && this.tokens[i - 1].type !== T.NEWLINE) i--;
        while (this.tokens[i] && (this.tokens[i].type === T.INDENT || this.tokens[i].type === T.DEDENT)) i++;
        const t0 = this.tokens[i];
        if (t0 && t0.type === T.IDENTIFIER && suggestWord(t0.value)) lineStart = t0;
      }
      if (lineStart) { this.error(suggestWord(lineStart.value) + ' (The indented line below it is a knock-on error.)', lineStart); return null; }
      if (tok.type === T.INDENT) msg = "This line is indented, but nothing above it starts a block. Remove the extra spaces, or put the line under an if, each, while, define or class.";
      else if (tok.type === T.NEWLINE || tok.type === T.EOF) msg = "This line ends too early -- something is missing after the last word (a value, a name, or a closing bracket).";
      else if (tok.type === T.DEDENT) msg = "This block stops too early -- something is missing before the indentation steps back.";
      else if (tok.type === T.RPAREN || tok.type === T.RBRACKET || tok.type === T.RBRACE) msg = `There's a closing '${tok.value ?? ''}' with no matching opening bracket.`;
      else {
        const hint = (tok.type === T.IDENTIFIER ? suggestWord(tok.value) : null)
          || (prevTok && prevTok.type === T.IDENTIFIER && prevTok.line === tok.line ? suggestWord(prevTok.value) : null);
        msg = `I didn't expect ${describeToken(tok)} here.` + (hint ? ' ' + hint : ' Check the words just before it on this line -- something may be misspelled or missing.');
      }
      this.error(msg, tok);
    }
    return null;
  }

  parseList() {
    const tok = this.advance();
    const elements = [];
    let hasRows = false, currentRow = [];
    while (!this.check(T.RBRACKET) && !this.check(T.EOF)) {
      const el = this.parseExpr();
      if (el) currentRow.push(el);
      if (this.eat(T.SEMICOLON)) {
        hasRows = true;
        elements.push(Node('ListLit', { elements: currentRow, line: tok.line, col: tok.col }));
        currentRow = [];
      } else if (!this.eat(T.COMMA)) break;
    }
    this.expect(T.RBRACKET, undefined, "Expected ']'");
    if (hasRows) {
      if (currentRow.length > 0) elements.push(Node('ListLit', { elements: currentRow, line: tok.line, col: tok.col }));
      return Node('ListLit', { elements, line: tok.line, col: tok.col });
    }
    return Node('ListLit', { elements: currentRow, line: tok.line, col: tok.col });
  }

  parseDict() {
    const tok = this.advance();
    const pairs = [];
    while (!this.check(T.RBRACE) && !this.check(T.EOF)) {
      const key = this.parseExpr();
      this.expect(T.COLON, undefined, "Expected ':' after dict key");
      const value = this.parseExpr();
      if (key && value) pairs.push({ key, value });
      if (!this.eat(T.COMMA)) break;
    }
    this.expect(T.RBRACE, undefined, "Expected '}'");
    return Node('DictLit', { pairs, line: tok.line, col: tok.col });
  }

  parse() {
    const body = [];
    this.skipNewlines();
    while (!this.check(T.EOF)) {
      if (this.check(T.DEDENT)) {
        this.error('This line is indented less than the code above it, but not back to a matching level. Line the spaces up (4 per level).');
        this.advance();
        this.skipNewlines();
        continue;
      }
      const s = this.parseStatement();
      if (s) body.push(s);
      this.skipNewlines();
    }
    return { ast: Node('Program', { body }), errors: this.errors };
  }
}

function parse(source) { return new Parser(source).parse(); }

// ── typechecker.js ───────────────────────────────────────────────────────────
const TYPE = Object.freeze({
  STRING: 'string', INTEGER: 'integer', FLOAT: 'float', BOOLEAN: 'boolean',
  LIST: 'list', DICT: 'dict', NONE: 'none', UNKNOWN: 'unknown', URL: 'url',
});

function compatible(from, to) {
  if (from === TYPE.UNKNOWN || to === TYPE.UNKNOWN) return true;
  if (from === to || from === TYPE.NONE || to === TYPE.NONE) return true;
  if (from === TYPE.INTEGER && to === TYPE.FLOAT) return true;
  if (from === TYPE.FLOAT && to === TYPE.INTEGER) return true;
  return false;
}

class TypeError_ {
  constructor(message, line, col) {
    this.message = message; this.line = line ?? 0; this.col = col ?? 0;
  }
  toString() { return `TypeError at ${this.line}:${this.col} — ${this.message}`; }
}

class TCEnv {
  constructor(parent = null, name = 'global') {
    this.parent = parent; this.name = name;
    this.vars = new Map(); this.fns = new Map();
  }
  define(name, type) { this.vars.set(name, { type, defined: type !== TYPE.NONE }); }
  lookup(name) { return this.vars.get(name) ?? this.parent?.lookup(name) ?? null; }
  update(name, type) {
    if (this.vars.has(name)) { this.vars.get(name).type = type; return true; }
    return this.parent?.update(name, type) ?? false;
  }
  defFn(name, params, returnType) { this.fns.set(name, { params, returnType }); }
  defClass(name, params, returnType) { this.fns.set(name, { params, returnType, isClass: true }); }
  lookupFn(name) { return this.fns.get(name) ?? this.parent?.lookupFn(name) ?? null; }
  lookupClass(name) { const fn = this.lookupFn(name); return fn?.isClass ? fn : null; }
  child(name) { return new TCEnv(this, name); }
}

const BUILTIN_NAMES = new Set([
  'int', 'flt', 'str', 'bin', 'list', 'dict', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'sqrt',
  'length', 'size', 'upper', 'lower', 'trim', 'split', 'join', 'contains', 'replace',
  'starts', 'ends', 'index', 'slice', 'pad', 'padend', 'chars', 'repeat', 'push', 'pop', 'keys', 'values', 'has',
  'sort', 'reverse', 'unique', 'flat', 'first', 'last', 'head', 'drop', 'zip', 'map', 'filter', 'reduce',
  'col', 'row', 'cols', 'rows', 'transpose', 'colnames', 'where', 'group', 'agg',
  'now', 'time', 'timestamp', 'year', 'month', 'day', 'hour', 'minute', 'weekday', 'dateadd', 'datediff', 'format',
  'merge', 'pick', 'omit', 'update', 'entries', 'fromkeys', 'match', 'findall', 'search', 'sub', 'split_re',
  'log', 'log2', 'log10', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pi', 'e', 'tau', 'inf', 'random', 'randint', 'roll', 'sign', 'clamp', 'lerp',
  'degrees', 'radians', 'gcd', 'lcm', 'isPrime', 'type', 'isString', 'isInt', 'isFloat', 'isBool', 'isList', 'isDict', 'isNone', 'isNum',
  'range', 'error', 'email', 'ask', 'sheets',
]);

class TypeChecker {
  constructor() {
    this.errors = [];
    this.globals = new TCEnv(null, 'global');
    this.globals.define('err', TYPE.NONE);
    for (const name of BUILTIN_NAMES) {
      this.globals.fns.set(name, { params: null, returnType: TYPE.UNKNOWN });
    }
  }
  err(msg, node) { this.errors.push(new TypeError_(msg, node?.line, node?.col)); }
  check(sourceOrParsed) {
    const parsed = (sourceOrParsed && typeof sourceOrParsed === 'object' && sourceOrParsed.ast)
      ? sourceOrParsed : parse(sourceOrParsed);
    if (parsed.errors.length) {
      const e0 = parsed.errors[0], more = parsed.errors.length - 1;
      this.errors.push(new TypeError_(e0.message + (more ? `\n(Fix this one first -- the ${more} after it are probably knock-on errors.)` : ''), e0.line, e0.col));
    }
    return { errors: this.errors, env: this.globals };
  }
}

function typecheck(sourceOrParsed) { return new TypeChecker().check(sourceOrParsed); }

// ── interpreter.js (ported from vertex.html; keywords per docvex) ──────────
const NONE = null;

// ── Packages from other languages ────────────────────────────────────────────
//   use python numpy as np        Python, via Pyodide (loaded the first time it's needed)
//   use js lodash as _             JavaScript, an npm package served as a browser module
//   use "https://site/tools.vx"    Mutter source (hash-pinned on first use)
// Foreign code runs on the page itself, not in a sandbox: only import packages you trust.
const FOREIGN = {
  PYODIDE_URL: 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/',
  JS_CDN: 'https://esm.sh/',
  py: null,
  pyLoading: null,
  out: null,          // where Python's print() goes (set per run)

  isPy(v) { return !!(v && FOREIGN.py && v instanceof FOREIGN.py.ffi.PyProxy); },
  isClassFn(f) {
    try { return typeof f === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(f)); } catch (e) { return false; }
  },
  // A foreign JS object/function (anything that isn't a Mutter value)
  isJsForeign(v) {
    if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false;
    if (v instanceof Map || Array.isArray(v) || FOREIGN.isPy(v)) return false;
    if (typeof IVXFunction !== 'undefined' && (v instanceof IVXFunction || v instanceof IVXClass || v instanceof IVXSuperProxy)) return false;
    return true;
  },
  _refuseFn(v) {
    if (typeof IVXFunction !== 'undefined' && (v instanceof IVXFunction || v instanceof IVXClass)) {
      throw new RuntimeError("Passing your own functions or classes into a package isn't supported yet. Pass values (numbers, text, lists, dicts) instead.");
    }
  },
  // Mutter value -> what a JS library expects (dicts become plain objects)
  toJS(v) {
    FOREIGN._refuseFn(v);
    if (v instanceof Map) {
      const o = {};
      for (const [k, x] of v) if (!String(k).startsWith('__')) o[k] = FOREIGN.toJS(x);
      return o;
    }
    if (Array.isArray(v)) return v.map(FOREIGN.toJS);
    return v;
  },
  // Mutter value -> Python (lists become list, dicts become dict)
  toPy(v) {
    FOREIGN._refuseFn(v);
    if (v instanceof Map || Array.isArray(v)) {
      const clean = (x) => {
        FOREIGN._refuseFn(x);
        if (x instanceof Map) { const m = new Map(); for (const [k, y] of x) if (!String(k).startsWith('__')) m.set(k, clean(y)); return m; }
        if (Array.isArray(x)) return x.map(clean);
        return x;
      };
      return FOREIGN.py.toPy(clean(v));
    }
    return v;
  },
  // JS library result -> Mutter value (plain objects become dicts)
  fromJS(v) {
    if (v === undefined || v === null) return NONE;
    if (typeof v === 'bigint') return Number(v);
    if (Array.isArray(v)) return v.map(FOREIGN.fromJS);
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v);
    if (typeof v === 'object' && !(v instanceof Map)) {
      const proto = Object.getPrototypeOf(v);
      if ((proto === Object.prototype || proto === null) && v[Symbol.toStringTag] !== 'Module') {
        const m = new Map();
        for (const k of Object.keys(v)) m.set(k, FOREIGN.fromJS(v[k]));
        return m;
      }
    }
    return v;
  },
  _npScalar(v) {
    try { return typeof v.item === 'function' && v.ndim === 0 && v.dtype !== undefined; } catch (e) { return false; }
  },
  // Python result -> Mutter value. Numbers/text/yes/no/none already arrive converted;
  // numpy scalars are unwrapped; everything else stays a live Python object so you can
  // keep calling its methods (df.head(), arr.mean()).
  fromPy(v) {
    if (v === undefined || v === null) return NONE;
    if (FOREIGN.isPy(v) && FOREIGN._npScalar(v)) return v.item();
    return v;
  },
  // Turn Python data (list, tuple, set, dict, numpy array) into Mutter lists/dicts.
  // Objects that aren't plain data (a DataFrame, a model) stay as they are.
  deep(v) {
    if (Array.isArray(v)) return v.some(x => FOREIGN.isPy(x) || Array.isArray(x)) ? v.map(FOREIGN.deep) : v;
    if (!FOREIGN.isPy(v)) return v;
    let t = '';
    try { t = v.type; } catch (e) {}
    if (FOREIGN._npScalar(v)) return v.item();
    if (t === 'list' || t === 'tuple' || t === 'set' || t === 'frozenset' || t === 'range') return Array.from(v, FOREIGN.deep);
    if (t === 'dict') {
      const m = new Map();
      for (const k of v.keys()) m.set(FOREIGN.deep(k), FOREIGN.deep(v.get(k)));
      return m;
    }
    if (/(^|\.)ndarray$/.test(t)) return FOREIGN.deep(v.tolist());
    return v;
  },
  pyBool(v) { return !!FOREIGN.py.globals.get('bool')(v); },
  PY_OPS: { '+': 'add', '-': 'sub', '*': 'mul', '/': 'truediv', '//': 'floordiv', '%': 'mod', '^': 'pow',
            'is': 'eq', '=': 'eq', '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' },
  pyBinOp(op, a, b) {
    const name = FOREIGN.PY_OPS[op];
    if (!name) return undefined;
    const operator = FOREIGN.py.pyimport('operator');
    return FOREIGN.fromPy(operator[name](FOREIGN.toPy(a), FOREIGN.toPy(b)));
  },
  repr(v) {
    if (FOREIGN.isPy(v)) { try { return String(v); } catch (e) { return '<python object>'; } }
    if (typeof v === 'function') return FOREIGN.isClassFn(v) ? `<class ${v.name || '?'}>` : `<function ${v.name || '?'}>`;
    if (v && typeof v === 'object') {
      if (v[Symbol.toStringTag] === 'Module') return '<module>';
      if (v instanceof Date) return v.toISOString();
      if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) { try { return String(v); } catch (e) {} }
      try { return JSON.stringify(v); } catch (e) {}
    }
    return '<object>';
  },
  errText(e) {
    const msg = (e && e.message) ? String(e.message) : String(e);
    if (e && (e.constructor && e.constructor.name === 'PythonError' || /Traceback \(most recent call last\)/.test(msg))) {
      const lines = msg.trim().split('\n').filter(l => l.trim());
      return 'Python said: ' + lines[lines.length - 1].trim();
    }
    return msg;
  },

  async loadPython(status) {
    if (FOREIGN.py) return FOREIGN.py;
    if (!FOREIGN.pyLoading) {
      FOREIGN.pyLoading = (async () => {
        if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Python packages need the browser');
        status && status('Loading Python (the first time takes a few seconds)...');
        if (typeof loadPyodide !== 'function') {
          await new Promise((resolve, reject) => {
            const tag = document.createElement('script');
            tag.src = FOREIGN.PYODIDE_URL + 'pyodide.js';
            tag.onload = resolve;
            tag.onerror = () => reject(new Error("couldn't download Python (check your internet connection)"));
            document.head.appendChild(tag);
          });
        }
        const py = await loadPyodide({ indexURL: FOREIGN.PYODIDE_URL });
        py.setStdout({ batched: (line) => { if (FOREIGN.out) FOREIGN.out(line); } });
        py.setStderr({ batched: (line) => { if (FOREIGN.out) FOREIGN.out(line); } });
        FOREIGN.py = py;
        return py;
      })();
      FOREIGN.pyLoading.catch(() => { FOREIGN.pyLoading = null; });
    }
    return FOREIGN.pyLoading;
  },

  async importPython(spec, status) {
    const py = await FOREIGN.loadPython(status);
    const quiet = { messageCallback: () => {}, errorCallback: () => {} };
    const isPipName = /[-]/.test(spec);          // python-slugify, scikit-learn: an install name, not an import name
    if (!isPipName) {
      // Packages Pyodide ships (numpy, pandas, scipy, matplotlib, ...) plus the standard library
      try { await py.loadPackagesFromImports('import ' + spec.split('.')[0], quiet); } catch (e) {}
      try {
        return py.pyimport(spec);
      } catch (e) {
        if (!/ModuleNotFoundError/.test(String(e && e.message))) throw e;
      }
    }
    const pipName = isPipName ? spec : spec.split('.')[0];
    let loaded = false;
    if (isPipName) { try { loaded = (await py.loadPackage(pipName, quiet)).length > 0; } catch (e) {} }
    if (!loaded) {
      // Not built in: install it from PyPI (works for pure-Python packages)
      status && status(`Installing ${pipName} from PyPI...`);
      await py.loadPackage('micropip', quiet);
      try {
        await py.pyimport('micropip').install(pipName);
      } catch (e) {
        throw new Error(`there's no Python package called '${pipName}' that can run in the browser (${FOREIGN.errText(e).replace(/^Python said: /, '')})`);
      }
    }
    if (!isPipName) return py.pyimport(spec);
    // find what the installed package is imported as
    py.runPython(`
def _mutter_import_names(dist):
    import importlib.metadata as md
    d = md.distribution(dist)
    names = (d.read_text('top_level.txt') or '').split()
    if not names and d.files:
        names = sorted({str(f).split('/')[0].removesuffix('.py') for f in d.files
                        if not str(f).split('/')[0].endswith(('.dist-info', '.data')) and not str(f).startswith('..')})
    return [n for n in names if not n.startswith('_')]
`);
    const names = py.globals.get('_mutter_import_names')(pipName).toJs();
    if (!names.length) throw new Error(`installed '${pipName}' but couldn't tell what to import`);
    return py.pyimport(names[0]);
  },

  async importPythonSource(url, name, status) {
    const py = await FOREIGN.loadPython(status);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const src = await res.text();
    try { await py.loadPackagesFromImports(src, { messageCallback: () => {}, errorCallback: () => {} }); } catch (e) {}
    const types = py.pyimport('types');
    const mod = types.ModuleType(name);
    py.runPython(src, { globals: mod.__dict__ });
    return mod;
  },

  async importJS(spec) {
    const url = /^https?:\/\//i.test(spec) ? spec : FOREIGN.JS_CDN + spec;
    let ns;
    // The editor's AMD loader defines a global define(). Older "UMD" packages (lodash, ...) see it and
    // register themselves with it instead of exporting, which leaves an empty module. Hide it while importing.
    const amdDefine = (typeof window !== 'undefined' && typeof window.define === 'function') ? window.define : null;
    const amdFlag = amdDefine ? amdDefine.amd : undefined;
    try {
      if (amdDefine) amdDefine.amd = undefined;
      ns = await import(url);
    } catch (e) {
      const m = String(e && e.message || e);
      if (/Failed to fetch|NetworkError|error loading dynamically imported module|Importing a module script failed/i.test(m)) {
        throw new Error(`couldn't download it -- check the package name (npm names are lowercase, like date-fns) and your internet connection`);
      }
      throw e;
    } finally {
      if (amdDefine) amdDefine.amd = amdFlag;
    }
    // A package with a default export (lodash, dayjs) is used as that thing; otherwise the module itself
    return (ns.default !== undefined && ns.default !== null) ? ns.default : ns;
  },
};

// ── Control flow signals ──────────────────────────────────────────────────────
// Used to unwind the call stack for 'out' (return) and loop control
class ReturnSignal { constructor(value) { this.value = value; } }
class BreakSignal { }
class ContinueSignal { }
class EndSignal { }

// ── Runtime error ─────────────────────────────────────────────────────────────
class RuntimeError extends Error {
  constructor(message, line, col) {
    super(message);
    this.ivxLine = line ?? 0;
    this.ivxCol = col ?? 0;
  }
}

// ── Environment (scope) ───────────────────────────────────────────────────────
class Env {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
    this.consts = new Set(); // inferred immutable bindings
  }

  get(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    return undefined;
  }

  set(name, value) {
    // Check const in this scope
    if (this.vars.has(name)) {
      if (this.consts.has(name)) {
        throw new RuntimeError(
          `Cannot reassign '${name}' — it was inferred immutable because it is never reassigned. If you meant to reassign it, use 'make ${name} ${name} + ...' or declare it with '?' to make it mutable.`,
          0
        );
      }
      this.vars.set(name, value);
      return;
    }
    // Check parent scope
    if (this.parent && this.parent.has(name)) { this.parent.set(name, value); return; }
    // New variable — define in current scope
    this.vars.set(name, value);
  }

  // Bind a name in THIS scope only (parameters, loop names, catch names, self/super) -- never touches an outer variable of the same name
  define(name, value) { this.vars.set(name, value); this.consts.delete(name); }

  setConst(name, value) {
    this.vars.set(name, value);
    this.consts.add(name);
  }

  isConst(name) {
    if (this.consts.has(name)) return true;
    return this.parent?.isConst(name) ?? false;
  }

  has(name) {
    if (this.vars.has(name)) return true;
    return this.parent?.has(name) ?? false;
  }

  del(name) {
    if (this.vars.has(name)) {
      if (this.consts.has(name)) {
        throw new RuntimeError(`Can't delete '${name}' — it was created inside a function and can't be removed this way`, 0);
      }
      this.vars.delete(name);
      return true;
    }
    return this.parent?.del(name) ?? false;
  }

  child() { return new Env(this); }
}

// ── IVX function (closure) ────────────────────────────────────────────────────
class IVXFunction {
  constructor(name, params, body, closure) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure; // captured environment
  }
}

class IVXClass {
  constructor(name, body, closure, superclass = null) {
    this.name = name;
    this.body = body ?? [];
    this.closure = closure;
    this.superclass = superclass;
    this.methods = new Map();
    this.initStmts = [];
  }

  initParams() {
    const m = this.methods.get('__init__');
    if (!m) return this.superclass ? this.superclass.initParams() : [];
    if (m.__extendParent && this.superclass) {
      // Parent's params the subclass didn't list are prepended; if it listed them, its own order wins.
      const own = new Set(m.params.map(q => (typeof q === 'string' ? q : q.name)));
      const missing = this.superclass.initParams().filter(q => !own.has(typeof q === 'string' ? q : q.name));
      return [...missing, ...m.params];
    }
    return m.params;
  }
  resolveMethod(name) {
    if (this.methods.has(name)) return this.methods.get(name);
    return this.superclass?.resolveMethod(name) ?? null;
  }

  async instantiate(args, interp) {
    const classEnv = this.closure ? this.closure.child() : interp.globals.child();
    const instance = new Map();
    instance.set('__class__', this.name);
    instance.set('__class_obj__', this);
    classEnv.define('self', instance);

    if (this.superclass) {
      classEnv.define('super', new IVXSuperProxy(instance, this));
    }

    const initMethod = this.resolveMethod('__init__');
    const ctorParams = initMethod ? this.initParams() : [];
    if (!initMethod && args.length > 0) {
      throw new RuntimeError(`'${this.name}' can't be created with values yet. Add params to its header, like: class ${this.name} with name`, 0, 0);
    }
    if (initMethod) {
      for (let i = 0; i < ctorParams.length; i++) {
        const pRaw = ctorParams[i];
        const pName = typeof pRaw === 'string' ? pRaw : pRaw.name;
        const value = args[i] ?? NONE;
        instance.set(pName, value);
        classEnv.define(pName, value);
      }
    }

    // Setup lines: every non-define line in a class body runs when an object is made, parent class first
    const chain = [];
    for (let c = this; c; c = c.superclass) chain.unshift(c);
    for (const c of chain) {
      for (const stmt of c.initStmts) await interp.execStmt(stmt, classEnv);
    }

    return instance;
  }
}

// ── Screen elements: #name ───────────────────────────────────────────────────
// Every #name in a program is an element on the Screen panel, made when the program starts.
// What kind it is comes from its name (…-btn, …-input, …-canvas) or from how it's used
// (clicked -> button, read with take -> text box, drawn on -> canvas, otherwise a label).
const CANVAS_METHODS = new Set(['circle', 'rect', 'line', 'write', 'clear', 'dot']);
const ELEMENT_EVENTS = { click: 'click', input: 'input', change: 'change', hover: 'mouseenter', enter: 'keydown' };
function elementKindFromName(name) {
  if (/(^|[-_])(btn|button)$/i.test(name)) return 'button';
  if (/(^|[-_])(input|box|field|textbox|entry)$/i.test(name)) return 'textbox';
  if (/(^|[-_])(canvas|pad|board|drawing)$/i.test(name)) return 'canvas';
  return null;
}
function humanizeElementName(name) {
  const words = name.replace(/(^|[-_])(btn|button|input|box|field|textbox|entry)$/i, '').split(/[-_]+/).filter(Boolean);
  const text = (words.length ? words : [name]).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
// Walk the program once and decide which elements exist and what kind each is
function scanElements(ast) {
  const order = [];
  const kinds = new Map();
  const vote = (name, kind) => {
    if (!kinds.has(name)) { order.push(name); kinds.set(name, new Set()); }
    if (kind) kinds.get(name).add(kind);
  };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'Element') vote(n.name, null);
    if (n.type === 'ElementValue') vote(n.name, 'textbox');
    if (n.type === 'On' && n.target) vote(n.target, n.event === 'click' ? 'button' : n.event === 'hover' ? null : 'textbox');
    if (n.type === 'MemberAccess' && n.object && n.object.type === 'Element') {
      if (CANVAS_METHODS.has(n.field)) vote(n.object.name, 'canvas');
      if (n.field === 'value' || n.field === 'placeholder') vote(n.object.name, 'textbox');
      if (n.field === 'label') vote(n.object.name, 'button');
    }
    for (const k in n) if (k !== 'type' && n[k] && typeof n[k] === 'object') walk(n[k]);
  };
  walk(ast);
  return order.map((name) => {
    const v = kinds.get(name);
    const kind = elementKindFromName(name) || (v.has('canvas') ? 'canvas' : v.has('textbox') ? 'textbox' : v.has('button') ? 'button' : 'label');
    return { name, kind };
  });
}
const elementText = (v) => (typeof v === 'string' ? v : ivxRepr(v));

class IVXElement {
  constructor(name, kind) {
    this.name = name;
    this.kind = kind;
    if (typeof document === 'undefined') throw new RuntimeError('Screen elements (#names) need the browser');
    const tag = { button: 'button', textbox: 'input', canvas: 'canvas', label: 'div' }[kind];
    const el = document.createElement(tag);
    el.className = 'mu-el mu-' + kind;
    el.id = 'mu-' + name;
    el.dataset.name = '#' + name;
    if (kind === 'button') { el.type = 'button'; el.textContent = humanizeElementName(name); }
    if (kind === 'textbox') { el.type = 'text'; el.placeholder = humanizeElementName(name).toLowerCase(); el.autocomplete = 'off'; }
    if (kind === 'canvas') { el.width = 320; el.height = 200; }
    this.dom = el;
  }
  _ctx() {
    if (this.kind !== 'canvas') throw new RuntimeError(`#${this.name} isn't a canvas. Give it a name ending in -canvas (like #${this.name}-canvas) to draw on it.`);
    return this.dom.getContext('2d');
  }
  get text() {
    if (this.kind === 'textbox') return this.dom.value;
    if (this.kind === 'canvas') return '';
    return this.dom.textContent;
  }
  set text(v) {
    if (this.kind === 'textbox') this.dom.value = elementText(v);
    else if (this.kind !== 'canvas') this.dom.textContent = elementText(v);
  }
  get value() { return this.text; }
  set value(v) { this.text = v; }
  get label() { return this.text; }
  set label(v) { this.text = v; }
  get placeholder() { return this.dom.placeholder || ''; }
  set placeholder(v) { this.dom.placeholder = elementText(v); }
  get color() { return this.dom.style.color || ''; }
  set color(v) { this.dom.style.color = elementText(v); }
  get background() { return this.dom.style.background || ''; }
  set background(v) { this.dom.style.background = elementText(v); }
  get size() { return parseFloat(this.dom.style.fontSize) || 16; }
  set size(v) { this.dom.style.fontSize = Number(v) + 'px'; }
  get visible() { return !this.dom.hidden; }
  set visible(v) { this.dom.hidden = !isTruthy(v); }
  get width() { return this.kind === 'canvas' ? this.dom.width : this.dom.offsetWidth; }
  set width(v) { if (this.kind === 'canvas') this.dom.width = Number(v); else this.dom.style.width = Number(v) + 'px'; }
  get height() { return this.kind === 'canvas' ? this.dom.height : this.dom.offsetHeight; }
  set height(v) { if (this.kind === 'canvas') this.dom.height = Number(v); else this.dom.style.height = Number(v) + 'px'; }
  // canvas drawing
  circle(x, y, r, color = 'black') { const c = this._ctx(); c.beginPath(); c.arc(+x, +y, +r, 0, Math.PI * 2); c.fillStyle = elementText(color); c.fill(); }
  dot(x, y, color = 'black') { this.circle(x, y, 2, color); }
  rect(x, y, w, h, color = 'black') { const c = this._ctx(); c.fillStyle = elementText(color); c.fillRect(+x, +y, +w, +h); }
  line(x1, y1, x2, y2, color = 'black', width = 2) { const c = this._ctx(); c.beginPath(); c.moveTo(+x1, +y1); c.lineTo(+x2, +y2); c.strokeStyle = elementText(color); c.lineWidth = +width; c.stroke(); }
  write(x, y, words, color = 'black', size = 16) { const c = this._ctx(); c.fillStyle = elementText(color); c.font = `${+size}px sans-serif`; c.fillText(elementText(words), +x, +y); }
  clear() { const c = this._ctx(); c.clearRect(0, 0, this.dom.width, this.dom.height); }
}

class IVXSuperProxy {
  constructor(self, ownerClass) {
    this.__kind__ = 'super';
    this.self = self;
    this.ownerClass = ownerClass;
  }
}

// The standard library: the only built-in function names a program can call directly.
// name in Mutter -> internal built-in. Everything else is a method (s.upper, items.sort, d.keys) or 'as'.
const STANDARD_LIBRARY = {
  abs: 'abs', round: 'round', floor: 'floor', ceil: 'ceil', min: 'min', max: 'max', sqrt: 'sqrt',
  pi: 'pi', sin: 'sin', cos: 'cos', tan: 'tan', atan2: 'atan2',
  random: 'random', randint: 'randint', pick: 'choose',
  range: 'range', now: 'now', time: 'time', type: 'type',
};
// Old global names -> what to write instead (shown when someone calls one)
const OLD_BUILTIN_HINTS = {
  int: 'x as int', flt: 'x as number', str: 'x as string', bin: 'x as bool', list: 'x as list', dict: 'x as dict',
  length: 'x.length', size: 'x.length', upper: 's.upper', lower: 's.lower', trim: 's.trim', split: 's.split(",")',
  join: 'items.join(", ")', contains: 's.contains("x")', replace: 's.replace("a", "b")', starts: 's.starts("x")',
  ends: 's.ends("x")', index: 's.index("x")', slice: 's[1:3]', chars: 's.chars', push: 'items.push(x)', pop: 'items.pop',
  keys: 'd.keys', values: 'd.values', has: 'd.has("key")', sum: 'items.sum', sort: 'items.sort', reverse: 'items.reverse',
  timestamp: 'now', len: 'x.length',
};
const BUILTIN_DEFS = {
  int: {
    params: ['x'],
    call: (args) => Math.trunc(Number(args[0])),
  },
  flt: {
    params: ['x'],
    call: (args) => Number(args[0]),
  },
  str: {
    params: ['x'],
    call: (args) => ivxRepr(args[0]),
  },
  bin: {
    params: ['x'],
    call: (args) => Boolean(args[0]),
  },
  list: {
    params: ['x'],
    call: (args) => Array.isArray(args[0]) ? args[0] : args[0] instanceof Map ? [...args[0].values()] : [args[0]],
  },
  dict: {
    params: ['x'],
    call: (args) => args[0] instanceof Map ? args[0] : new Map(Object.entries(args[0] ?? {})),
  },
  length: {
    params: ['x'],
    call: (args, node) => {
      const v = args[0];
      if (typeof v === 'string') return v.length;
      if (Array.isArray(v)) return v.length;
      if (v instanceof Map) return v.size;
      throw new RuntimeError(`size() works on strings, lists, and dicts — not this type`, node?.line);
    },
  },
  keys: {
    params: ['d'],
    call: (args) => args[0] instanceof Map ? [...args[0].keys()] : [],
  },
  values: {
    params: ['d'],
    call: (args) => args[0] instanceof Map ? [...args[0].values()] : [],
  },
  has: {
    params: ['d', 'k'],
    call: (args) => args[0] instanceof Map ? args[0].has(args[1]) : false,
  },
  push: {
    params: ['list', 'val'],
    call: (args) => {
      if (Array.isArray(args[0])) args[0].push(args[1]);
      return args[0];
    },
  },
  pop: {
    params: ['list'],
    call: (args) => {
      if (Array.isArray(args[0])) return args[0].pop() ?? NONE;
      return NONE;
    },
  },
  abs: {
    params: ['x'],
    call: (args) => Math.abs(args[0]),
  },
  floor: {
    params: ['x'],
    call: (args) => Math.floor(args[0]),
  },
  ceil: {
    params: ['x'],
    call: (args) => Math.ceil(args[0]),
  },
  round: {
    params: ['x'],
    call: (args) => Math.round(args[0]),
  },
  min: {
    params: ['a', 'b'],
    call: (args) => { const xs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args; return xs.length ? Math.min(...xs) : NONE; },
  },
  max: {
    params: ['a', 'b'],
    call: (args) => { const xs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args; return xs.length ? Math.max(...xs) : NONE; },
  },
  sqrt: {
    params: ['x'],
    call: (args) => Math.sqrt(args[0]),
  },
  pi: { params: [], call: () => Math.PI },
  e: { params: [], call: () => Math.E },
  tau: { params: [], call: () => Math.PI * 2 },
  inf: { params: [], call: () => Infinity },
  // random() is 0 to 1; random(n) is 0 to n; random(a, b) is a to b (decimals). randint gives whole numbers.
  random: { params: [], call: (args) => {
    if (args.length >= 2) return Number(args[0]) + Math.random() * (Number(args[1]) - Number(args[0]));
    if (args.length === 1) return Math.random() * Number(args[0]);
    return Math.random();
  } },
  // pick(list): one item at random
  choose: { params: ['items'], call: (args, node) => {
    const xs = args[0];
    if (typeof xs === 'string') return xs.length ? xs[Math.floor(Math.random() * xs.length)] : NONE;
    if (!Array.isArray(xs)) throw new RuntimeError('pick needs a list, like pick(colors)', node?.line);
    return xs.length ? xs[Math.floor(Math.random() * xs.length)] : NONE;
  } },
  randint: { params: ['a', 'b'], call: (args) => Math.floor(Math.random() * (args[1] - args[0] + 1)) + args[0] },
  log: {
    params: ['x', 'base'],
    call: (args) => {
      const x = args[0];
      const base = args[1] ?? NONE;
      if (base === NONE) return Math.log(x);
      if (base === 10) return Math.log10(x);
      if (base === 2) return Math.log2(x);
      return Math.log(x) / Math.log(base);
    },
  },
  log2: { params: ['x'], call: (args) => Math.log2(args[0]) },
  log10: { params: ['x'], call: (args) => Math.log10(args[0]) },
  sin: { params: ['x'], call: (args) => Math.sin(args[0]) },
  cos: { params: ['x'], call: (args) => Math.cos(args[0]) },
  tan: { params: ['x'], call: (args) => Math.tan(args[0]) },
  asin: { params: ['x'], call: (args) => Math.asin(args[0]) },
  acos: { params: ['x'], call: (args) => Math.acos(args[0]) },
  atan: { params: ['x'], call: (args) => Math.atan(args[0]) },
  atan2: { params: ['y', 'x'], call: (args) => Math.atan2(args[0], args[1]) },
  upper: {
    params: ['s'],
    call: (args) => String(args[0]).toUpperCase(),
  },
  lower: {
    params: ['s'],
    call: (args) => String(args[0]).toLowerCase(),
  },
  trim: {
    params: ['s'],
    call: (args) => String(args[0]).trim(),
  },
  split: {
    params: ['s', 'sep'],
    call: (args) => String(args[0]).split(args[1] ?? ''),
  },
  join: {
    params: ['list', 'sep'],
    call: (args, node) => {
      // Relational join overload: join(left, right, leftCol, rightCol[, kind])
      if (args.length >= 4) {
        return tableJoin(args[0], args[1], args[2], args[3], args[4] ?? 'inner', node);
      }
      // Original string/list join behavior
      return (args[0] ?? []).join(args[1] ?? '');
    },
  },
  where: {
    params: ['table', 'col', 'op', 'value'],
    call: (args, node) => tableWhere(args, node),
  },
  order: {
    params: ['table', 'col', 'dir'],
    call: (args) => tableOrder(args[0], args[1], args[2] ?? 'asc'),
  },
  group: {
    params: ['table', 'cols'],
    call: (args) => tableGroup(args[0], args[1]),
  },
  agg: {
    params: ['grouped', 'col', 'fn', 'as'],
    call: (args, node) => tableAgg(args[0], args[1], args[2], args[3], node),
  },
  contains: {
    params: ['s', 'sub'],
    call: (args) => String(args[0]).includes(String(args[1])),
  },
  replace: {
    params: ['s', 'from', 'to'],
    call: (args) => String(args[0]).replaceAll(String(args[1]), String(args[2])),
  },
  starts: { params: ['s', 'prefix'], call: (args) => String(args[0]).startsWith(String(args[1])) },
  ends: { params: ['s', 'suffix'], call: (args) => String(args[0]).endsWith(String(args[1])) },
  index: { params: ['s', 'sub'], call: (args) => { const i = String(args[0]).indexOf(String(args[1])); return i === -1 ? NONE : i; } },
  slice: { params: ['s', 'start', 'end'], call: (args) => { const s = String(args[0]); return (args[2] != null && args[2] !== NONE) ? s.slice(args[1], args[2]) : s.slice(args[1]); } },
  chars: { params: ['s'], call: (args) => [...String(args[0])] },
  size: { params: ['x'], call: (args) => { const v = args[0]; if (typeof v === 'string') return v.length; if (Array.isArray(v)) return v.length; if (v instanceof Map) return v.size; return 0; } },

  // ── List methods ──────────────────────────────────────────────────────────
  // ── 2D grid (table) ───────────────────────────────────────────────────────
  colnames: {
    params: ['table'],
    call: (args) => {
      const t = args[0];
      if (!Array.isArray(t) || !(t[0] instanceof Map)) return NONE;
      return [...t[0].keys()].filter(k => !String(k).startsWith('__'));
    },
  },
  now: { params: [], call: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } },
  time: { params: [], call: () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; } },
  timestamp: { params: [], call: () => Date.now() },
  // ── Type and utility ────────────────────────────────────────────────────
  type: {
    params: ['x'],
    call: (args) => {
      const v = args[0];
      if (v === NONE || v === null) return 'none';
      if (v === true || v === false) return 'bool';
      if (v instanceof IVXFunction) return 'function';
      if (v instanceof IVXClass) return 'class';
      if (v instanceof Map) return v.get('__class__') ? String(v.get('__class__')).toLowerCase() : 'dict';
      if (Array.isArray(v)) return 'list';
      if (typeof v === 'string') return 'string';
      if (Number.isInteger(v)) return 'int';
      if (typeof v === 'number') return 'float';
      return 'unknown';
    },
  },
  isString: { params: ['x'], call: (args) => typeof args[0] === 'string' },
  isInt: { params: ['x'], call: (args) => typeof args[0] === 'number' && Number.isInteger(args[0]) },
  isFloat: { params: ['x'], call: (args) => typeof args[0] === 'number' && !Number.isInteger(args[0]) },
  isBool: { params: ['x'], call: (args) => args[0] === true || args[0] === false },
  isList: { params: ['x'], call: (args) => Array.isArray(args[0]) },
  isDict: { params: ['x'], call: (args) => args[0] instanceof Map },
  isNone: { params: ['x'], call: (args) => args[0] === NONE || args[0] === null },
  isNum: { params: ['x'], call: (args) => typeof args[0] === 'number' },
  range: {
    params: ['n'],
    call: (args, node) => {
      if (args.length >= 2) {
        const a = Math.trunc(Number(args[0])), b = Math.trunc(Number(args[1]));
        if (!isFinite(a) || !isFinite(b)) throw new RuntimeError('range() needs whole numbers', node?.line);
        if (b - a > 100000) throw new RuntimeError('range() limit is 100,000 — try a smaller number', node?.line);
        return b <= a ? [] : Array.from({ length: b - a }, (_, i) => a + i);
      }
      const n = Math.trunc(Number(args[0]));
      if (!isFinite(n)) throw new RuntimeError('range() needs a whole number, not this', node?.line);
      if (n < 0) return [];
      if (n > 100000) throw new RuntimeError('range() limit is 100,000 — try a smaller number', node?.line);
      return Array.from({ length: n }, (_, i) => i);
    },
  },
  error: {
    params: ['msg'],
    call: (args, node) => { throw new RuntimeError(String(args[0] ?? 'error'), node?.line); },
  },

  // ── Dict operations ─────────────────────────────────────────────────────
  merge: {
    params: ['a', 'b'],
    call: (args) => {
      const a = args[0]; const b = args[1];
      if (!(a instanceof Map) || !(b instanceof Map)) return a ?? NONE;
      const result = new Map(a);
      for (const [k, v] of b) result.set(k, v);
      return result;
    },
  },
  pick: {
    params: ['d', 'keys'],
    call: (args) => {
      const d = args[0]; const keys = args[1];
      if (!(d instanceof Map)) return new Map();
      const result = new Map();
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) if (d.has(k)) result.set(k, d.get(k));
      return result;
    },
  },
  omit: {
    params: ['d', 'keys'],
    call: (args) => {
      const d = args[0]; const keys = args[1];
      if (!(d instanceof Map)) return new Map();
      const result = new Map(d);
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) result.delete(k);
      return result;
    },
  },
  update: {
    params: ['d', 'key', 'val'],
    call: (args) => {
      const d = args[0];
      if (!(d instanceof Map)) return d;
      const result = new Map(d);
      result.set(args[1], args[2]);
      return result;
    },
  },
  entries: {
    params: ['d'],
    call: (args) => {
      const d = args[0];
      if (!(d instanceof Map)) return [];
      return [...d.entries()]
        .filter(([k]) => !String(k).startsWith('__'))
        .map(([k, v]) => [k, v]);
    },
  },
  fromkeys: {
    params: ['keys', 'val'],
    call: (args) => {
      const keys = args[0]; const val = args[1] ?? NONE;
      if (!Array.isArray(keys)) return new Map();
      const result = new Map();
      for (const k of keys) result.set(k, val);
      return result;
    },
  },

  // ── Regular expressions ───────────────────────────────────────────────────
  match: {
    params: ['s', 'pattern'],
    call: (args, node) => {
      try {
        return new RegExp(String(args[1])).test(String(args[0]));
      } catch (e) { throw new RuntimeError(`match: invalid pattern: ${e.message}`, node?.line); }
    },
  },
  findall: {
    params: ['s', 'pattern'],
    call: (args, node) => {
      try {
        const matches = String(args[0]).match(new RegExp(String(args[1]), 'g'));
        return matches ?? [];
      } catch (e) { throw new RuntimeError(`findall: invalid pattern: ${e.message}`, node?.line); }
    },
  },
  search: {
    params: ['s', 'pattern'],
    call: (args, node) => {
      try {
        const m = String(args[0]).match(new RegExp(String(args[1])));
        if (!m) return NONE;
        const result = new Map();
        result.set('match', m[0]);
        result.set('index', m.index);
        result.set('groups', m.slice(1));
        return result;
      } catch (e) { throw new RuntimeError(`search: invalid pattern: ${e.message}`, node?.line); }
    },
  },
  sub: {
    params: ['s', 'pattern', 'replacement'],
    call: (args, node) => {
      try {
        return String(args[0]).replace(new RegExp(String(args[1]), 'g'), String(args[2]));
      } catch (e) { throw new RuntimeError(`sub: invalid pattern: ${e.message}`, node?.line); }
    },
  },
  split_re: {
    params: ['s', 'pattern'],
    call: (args, node) => {
      try {
        return String(args[0]).split(new RegExp(String(args[1])));
      } catch (e) { throw new RuntimeError(`split_re: invalid pattern: ${e.message}`, node?.line); }
    },
  },

  format: {
    params: ['date', 'pattern'], call: (args) => {
      const d = new Date(args[0]);
      return String(args[1] ?? 'YYYY-MM-DD')
        .replace('YYYY', d.getFullYear()).replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(d.getDate()).padStart(2, '0')).replace('HH', String(d.getHours()).padStart(2, '0'))
        .replace('mm', String(d.getMinutes()).padStart(2, '0')).replace('ss', String(d.getSeconds()).padStart(2, '0'))
        .replace('ddd', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()])
        .replace('dddd', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]);
    }
  },
  email: {
    params: ['to', 'subject', 'body'],
    call: async (args, node, interp) => {
      const to = String(args[0] ?? '');
      const subject = String(args[1] ?? '');
      const body = String(args[2] ?? '');

      if (!to) throw new Error("email: missing recipient address");

      // Robust Unicode-safe Base64URL for Gmail
      const emailContent = `To: ${to}\nSubject: ${subject}\n\n${body}`;
      const base64 = btoa(encodeURIComponent(emailContent).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await interp.runtime._googleAPI(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          body: JSON.stringify({ raw: base64 })
        }
      );


      interp.onOutput?.(`Email sent to ${to}`);
      return true;
    }
  },
  ask: {
    params: ['provider', 'prompt'],
    call: async (args, node, interp) => {
      const provider = String(args[0] ?? 'gemini').toLowerCase();
      const prompt = String(args[1] ?? '');
      return await interp.runtime.ask(provider, prompt);
    }
  },
};

function ivxToPlain(value) {
  if (value === NONE || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(v => ivxToPlain(v));
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value.entries()) obj[String(k)] = ivxToPlain(v);
    return obj;
  }
  if (typeof value === 'object') {
    const obj = {};
    for (const [k, v] of Object.entries(value)) obj[k] = ivxToPlain(v);
    return obj;
  }
  return value;
}

function tableToObjectRows(table) {
  if (!Array.isArray(table)) return [];
  if (table.length === 0) return [];

  // Row objects (plain objects / maps)
  if (table.every(r => r instanceof Map || (r && typeof r === 'object' && !Array.isArray(r)))) {
    return table.map(r => (r instanceof Map ? ivxToPlain(r) : ivxToPlain(r)));
  }

  // 2D list rows -> object rows (header-aware)
  if (table.every(r => Array.isArray(r))) {
    const first = table[0] ?? [];
    const hasHeader = first.every(c => typeof c === 'string');
    const rows = hasHeader ? table.slice(1) : table;
    const headers = hasHeader
      ? first
      : Array.from({ length: Math.max(...rows.map(r => r.length), 0) }, (_, i) => `c${i}`);

    return rows.map(r => {
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = ivxToPlain(r[i]);
      return obj;
    });
  }

  return table.map(v => ({ value: ivxToPlain(v) }));
}

function tableCompare(left, op, right) {
  switch (op) {
    case '=': return left === right;
    case '!=': return left !== right;
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    case 'contains': return String(left ?? '').includes(String(right ?? ''));
    default: return left === right;
  }
}

function tableWhere(args, node) {
  const rows = tableToObjectRows(args[0]);
  const col = String(args[1] ?? '');
  if (!col) throw new RuntimeError("where() requires a column name", node?.line);

  let op = '=';
  let val = NONE;
  if (args.length >= 4) {
    op = String(args[2] ?? '=');
    val = ivxToPlain(args[3]);
  } else {
    val = ivxToPlain(args[2]);
  }

  return rows.filter(r => tableCompare(r[col], op, val));
}

function tableOrder(table, col, dir = 'asc') {
  const rows = tableToObjectRows(table);
  const key = String(col ?? '');
  const sign = String(dir).toLowerCase() === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av === bv) return 0;
    return av > bv ? sign : -sign;
  });
}

function tableGroup(table, cols) {
  const rows = tableToObjectRows(table);
  const keys = Array.isArray(cols) ? cols.map(String) : [String(cols ?? '')];
  const buckets = new Map();

  for (const row of rows) {
    const keyObj = {};
    for (const k of keys) keyObj[k] = row?.[k];
    const key = JSON.stringify(keyObj);
    if (!buckets.has(key)) buckets.set(key, { key: keyObj, rows: [] });
    buckets.get(key).rows.push(row);
  }

  return [...buckets.values()];
}

function tableAgg(grouped, col, fn, asName, node) {
  if (!Array.isArray(grouped)) throw new RuntimeError('agg() needs grouped data — use groupby() first', node?.line);
  const key = String(col ?? '');
  const op = String(fn ?? 'count').toLowerCase();
  const outKey = String(asName ?? `${op}_${key}`);

  return grouped.map(g => {
    const rows = Array.isArray(g?.rows) ? g.rows : [];
    const values = rows.map(r => r?.[key]).filter(v => v !== null && v !== undefined);
    let value;

    if (op === 'count') value = rows.length;
    else if (op === 'sum') value = values.reduce((a, v) => a + Number(v || 0), 0);
    else if (op === 'avg') value = values.length ? values.reduce((a, v) => a + Number(v || 0), 0) / values.length : 0;
    else if (op === 'min') value = values.length ? values.reduce((a, v) => (a < v ? a : v)) : NONE;
    else if (op === 'max') value = values.length ? values.reduce((a, v) => (a > v ? a : v)) : NONE;
    else throw new RuntimeError(`'${op}' isn't a valid aggregation — try sum, avg, min, max, or count`, node?.line);

    return { ...(g?.key ?? {}), [outKey]: value };
  });
}

function tableJoin(leftTable, rightTable, leftCol, rightCol, kind = 'inner', node) {
  const left = tableToObjectRows(leftTable);
  const right = tableToObjectRows(rightTable);
  const lCol = String(leftCol ?? '');
  const rCol = String(rightCol ?? '');
  const mode = String(kind ?? 'inner').toLowerCase();

  if (!lCol || !rCol) throw new RuntimeError('join() needs a key column on both sides', node?.line);

  const rIndex = new Map();
  for (const r of right) {
    const key = r?.[rCol];
    if (!rIndex.has(key)) rIndex.set(key, []);
    rIndex.get(key).push(r);
  }

  const out = [];
  const rightSeen = new Set();
  for (const l of left) {
    const key = l?.[lCol];
    const matches = rIndex.get(key) ?? [];
    if (matches.length === 0) {
      if (mode === 'left' || mode === 'full') out.push({ ...l });
      continue;
    }
    for (const r of matches) {
      rightSeen.add(r);
      const merged = { ...l };
      for (const [k, v] of Object.entries(r ?? {})) {
        if (k in merged) merged[`r_${k}`] = v;
        else merged[k] = v;
      }
      out.push(merged);
    }
  }

  if (mode === 'right' || mode === 'full') {
    for (const r of right) {
      if (rightSeen.has(r)) continue;
      out.push({ ...r });
    }
  }

  return out;
}


// ── IVXRuntime — I/O, external services, file operations ─────────────────────
// All side effects live here. The Interpreter calls this.runtime.<method>()
// To add a new integration (text, Telegram, etc.) add a method here.
class IVXRuntime {
  constructor(interp) {
    this._interp = interp;
    this.apiKey = null;
  }

  setKey(key) { this.apiKey = key; }

  async ask(provider, prompt) {
    if (provider === 'gemini') {
      const key = this.apiKey || this._interp.globals.get('__credential__');
      if (!key) throw new Error("No API key provided. Use: key \"your-key\"");

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    return "";
  }



  async _executePost(node, env, { storeResponse = false } = {}) {
    const url = await this._interp.evalExpr(node.url, env);
    const body = await this._interp.evalExpr(node.body, env);
    const cred = node.credential
      ? await this._interp.evalExpr(node.credential, env)
      : this._interp.globals.get('__credential__') ?? null;
    const headers = { 'Content-Type': 'application/json' };
    if (cred) headers['Authorization'] = `Bearer ${cred}`;

    try {
      const res = await fetch(String(url), {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      const ct = res.headers.get('content-type') || '';
      const result = ct.includes('application/json') ? await res.json() : await res.text();
      if (storeResponse) {
        // Convenience variable for statement-form post.
        this._interp.globals.set('response', result);
      }
      return result;
    } catch (e) {
      throw new RuntimeError(`post failed: ${e.message}`, node.line);
    }
  }

  async _executeGet(node, env) {
    const credName = this._interp.globals.get('__credName__') ?? null;
    const baseUrl = this._interp.globals.get('__credBase__') ?? null;
    let rawUrl = String((await this._interp.evalExpr(node.url, env)) ?? '').trim();

    // Resolve relative paths against the stored base URL for this credential
    if (!rawUrl.startsWith('http') && baseUrl) {
      rawUrl = String(baseUrl).replace(/\/$/, '') + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);
    }

    // Build auth headers from named credential store
    const headers = {};
    if (credName && window.IVX?.credentials) {
      const auth = window.IVX.credentials.authHeader(credName);
      if (auth) headers[auth.key] = auth.value;
    }

    // Optional query params: get "/users" {active: yes}
    if (node.params) {
      const params = await this._interp.evalExpr(node.params, env);
      if (params instanceof Map && params.size > 0) {
        const qs = new URLSearchParams();
        for (const [k, v] of params) {
          qs.set(String(k), v === true ? 'true' : v === false ? 'false' : String(v));
        }
        rawUrl += (rawUrl.includes('?') ? '&' : '?') + qs.toString();
      }
    }

    try {
      const res = await fetch(rawUrl, { method: 'GET', headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new RuntimeError(`get ${rawUrl} → ${res.status}: ${txt}`, node.line);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        return this._jsonToIVX(json);
      }
      return await res.text();
    } catch (e) {
      if (e instanceof RuntimeError) throw e;
      throw new RuntimeError(`get failed: ${e.message}`, node.line);
    }
  }

  // Recursively convert plain JSON to KH runtime types (Map for objects, Array for arrays)
  _jsonToIVX(val) {
    if (val === null || val === undefined) return NONE;
    if (Array.isArray(val)) return val.map(v => this._jsonToIVX(v));
    if (typeof val === 'object') {
      const map = new Map();
      for (const [k, v] of Object.entries(val)) map.set(k, this._jsonToIVX(v));
      return map;
    }
    return val;
  }

  _ivxToPlain(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map(v => this._ivxToPlain(v));
    if (value instanceof Map) {
      const obj = {};
      for (const [k, v] of value.entries()) obj[String(k)] = this._ivxToPlain(v);
      return obj;
    }
    if (typeof value === 'object') {
      const obj = {};
      for (const [k, v] of Object.entries(value)) obj[k] = this._ivxToPlain(v);
      return obj;
    }
    return value;
  }

  _escapeDelimitedCell(val, delimiter) {
    const s = String(val ?? '');
    const needsQuote = s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delimiter);
    const escaped = s.replace(/"/g, '""');
    return needsQuote ? `"${escaped}"` : escaped;
  }

  _toDelimitedText(value, delimiter) {
    const plain = this._ivxToPlain(value);

    if (Array.isArray(plain)) {
      if (plain.length === 0) return '';

      if (plain.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
        const headers = [];
        for (const row of plain) {
          for (const k of Object.keys(row)) {
            if (!headers.includes(k)) headers.push(k);
          }
        }
        const lines = [];
        lines.push(headers.map(h => this._escapeDelimitedCell(h, delimiter)).join(delimiter));
        for (const row of plain) {
          const line = headers
            .map(h => this._escapeDelimitedCell(row[h] ?? '', delimiter))
            .join(delimiter);
          lines.push(line);
        }
        return lines.join('\n');
      }

      if (plain.every(row => Array.isArray(row))) {
        return plain
          .map(row => row.map(cell => this._escapeDelimitedCell(cell, delimiter)).join(delimiter))
          .join('\n');
      }

      const header = this._escapeDelimitedCell('value', delimiter);
      const body = plain.map(v => this._escapeDelimitedCell(v, delimiter)).join('\n');
      return body ? `${header}\n${body}` : header;
    }

    if (plain && typeof plain === 'object') {
      const keys = Object.keys(plain);
      const header = keys.map(k => this._escapeDelimitedCell(k, delimiter)).join(delimiter);
      const row = keys.map(k => this._escapeDelimitedCell(plain[k], delimiter)).join(delimiter);
      return `${header}\n${row}`;
    }

    return String(plain ?? '');
  }

  _serializeForSave(value, filename) {
    const match = /\.([A-Za-z0-9]+)$/.exec(filename);
    const ext = (match?.[1] ?? 'txt').toLowerCase();

    if (ext === 'json') {
      return {
        filename,
        mimeType: 'application/json',
        content: JSON.stringify(this._ivxToPlain(value), null, 2),
      };
    }
    if (ext === 'csv') {
      return {
        filename,
        mimeType: 'text/csv',
        content: this._toDelimitedText(value, ','),
      };
    }
    if (ext === 'tsv') {
      return {
        filename,
        mimeType: 'text/tab-separated-values',
        content: this._toDelimitedText(value, '\t'),
      };
    }
    if (ext === 'xlsx') {
      this._interp.globals.set('err', "save: '.xlsx' uses CSV content in zero-dependency mode");
      return {
        filename,
        mimeType: 'text/csv',
        content: this._toDelimitedText(value, ','),
      };
    }

    return {
      filename,
      mimeType: 'text/plain',
      content: typeof value === 'string' ? value : ivxRepr(value),
    };
  }

  async _saveLocalFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async _saveDriveFile(filename, content, mimeType) {
    if (!driveToken) {
      throw new RuntimeError("Sign in to Google first to save to Drive", 0);
    }

    await driveEnsureFolder();
    const escapedName = String(filename).replace(/'/g, "\\'");
    const q = `'${driveFolderId}' in parents and name='${escapedName}' and trashed=false`;
    const found = await driveAPI(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    let fileId = found.files?.[0]?.id ?? null;

    if (!fileId) {
      const meta = await driveAPI('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: filename,
          parents: [driveFolderId],
          mimeType: mimeType || 'text/plain',
        }),
      });
      fileId = meta.id;
    }

    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + driveToken,
        'Content-Type': mimeType || 'text/plain',
      },
      body: content,
    });
    if (!res.ok) {
      throw new RuntimeError(`save: Drive upload failed (${res.status})`, 0);
    }

    if (typeof driveListFiles === 'function') {
      try { await driveListFiles(); } catch (_) { }
    }
  }

  async _executeSave(node, env) {
    let value;
    if (node.valueExpr) {
      value = await this._interp.evalExpr(node.valueExpr, env);
    } else if (this._interp.globals.has('response')) {
      value = this._interp.globals.get('response');
    } else if (this._interp.globals.has('err')) {
      value = this._interp.globals.get('err');
    } else {
      value = NONE;
    }

    let rawName = await this._interp.evalExpr(node.filenameExpr, env);
    let filename = String(rawName ?? '').trim();
    if (!filename) {
      throw new RuntimeError("save: filename cannot be empty", node.line);
    }

    // Auto-name: no extension was given — pick one based on value type
    if (node.autoName && !filename.includes('.')) {
      if (Array.isArray(value) || value instanceof Map) {
        filename += '.json';
      } else {
        filename += '.txt';
      }
    }

    const payload = this._serializeForSave(value, filename);
    if (node.target === 'local') {
      await this._saveLocalFile(payload.filename, payload.content, payload.mimeType);
      return;
    }
    await this._saveDriveFile(payload.filename, payload.content, payload.mimeType);
  }


  async _evalAskExpr(node, env) {
    const prompt = await this._interp.evalExpr(node.prompt, env);
    const credential = node.credential
      ? await this._interp.evalExpr(node.credential, env)
      : this._interp.globals.get('__credential__') ?? null;
    const model = (node.model ?? 'gemini').toLowerCase();

    // Determine if this is a cloud provider or a local one
    const cloudProviders = ['gemini', 'google', 'chatgpt', 'gpt', 'claude', 'anthropic'];
    const isCloud = cloudProviders.includes(model);

    if (!credential && isCloud) {
      throw new RuntimeError(
        `ask ${model}: no API key. Add: make key "your-key" use key`,
        node.line
      );
    }

    try {
      // Local AI (Ollama) fallback
      if (!isCloud || model === 'local') {
        const ollamaModel = model === 'local' ? 'gemma' : model;
        const res = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            prompt: String(prompt),
            stream: false
          }),
        });
        if (!res.ok) {
          let extra = '';
          if (res.status === 404) extra = `. Model '${ollamaModel}' not found. Have you pulled it? (ollama pull ${ollamaModel})`;
          throw new RuntimeError(`Local AI (Ollama) error ${res.status}: ${res.statusText}${extra}`, node.line);
        }
        const data = await res.json();
        return data?.response ?? '';
      }

      if (model === 'gemini' || model === 'google') {
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${credential}`;
        const res = await fetch(url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: String(prompt) }] }]
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new RuntimeError(
            `Gemini error ${res.status}: ${err?.error?.message ?? res.statusText}`,
            node.line
          );
        }
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      }

      if (model === 'chatgpt' || model === 'gpt') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${credential}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: String(prompt) }],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new RuntimeError(
            `OpenAI error ${res.status}: ${err?.error?.message ?? res.statusText}`,
            node.line
          );
        }
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? '';
      }

      if (model === 'claude' || model === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': credential,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            messages: [{ role: 'user', content: String(prompt) }],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new RuntimeError(
            `Claude error ${res.status}: ${err?.error?.message ?? res.statusText}`,
            node.line
          );
        }
        const data = await res.json();
        return data?.content?.[0]?.text ?? '';
      }

      throw new RuntimeError(
        `Unknown model '${model}'. Use: gemini, chatgpt, or claude`,
        node.line
      );

    } catch (e) {
      if (e instanceof RuntimeError) throw e;
      let msg = e.message;
      if ((msg === 'Failed to fetch' || msg.includes('NetworkError')) && (!isCloud || model === 'local')) {
        msg = "Could not connect to Ollama. Is it running? If so, make sure OLLAMA_ORIGINS=\"*\" is set in your environment variables to allow browser access.";
      }
      throw new RuntimeError(`ask ${model} failed: ${msg}`, node.line);
    }
  }

  // ── Google service helpers ────────────────────────────────────────────────

  _googleToken() {
    // driveToken is the shared OAuth token from the browser UI
    if (typeof driveToken !== 'undefined' && driveToken) return driveToken;
    // Fallback: use the key set via 'key "..."' command
    const globalCred = this._interp.globals.get('__credential__');
    if (globalCred) return globalCred;
    return null;
  }


  async _googleAPI(url, opts = {}) {
    const token = this._googleToken();
    if (!token) throw new RuntimeError('Not signed in to Google. Click "Sign in to Google" first.', null);
    console.log(`[IVX] Google API Call: ${url}`);
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message ?? err?.error?.status ?? res.statusText;
      throw new RuntimeError(`Google API error ${res.status}: ${msg}`, null);
    }
    return res.json();
  }

  // ── sheets <name> — returns a handle with .read and .write ───────────────
  async _evalSheetsOpenExpr(node, env) {
    const name = String(await this._interp.evalExpr(node.name, env));
    const token = this._googleToken();
    if (!token) throw new RuntimeError('Not signed in to Google. Click "Sign in to Google" first.', node.line);

    // If name looks like a Spreadsheet ID (long alphanumeric), use it directly
    let spreadsheetId = name;
    if (name.length < 30 || name.includes(' ') || name.includes('/')) {
      // Find the spreadsheet by name in Drive
      const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
      const listRes = await this._googleAPI(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`
      );
      const file = listRes?.files?.[0];
      if (!file) throw new RuntimeError(`Spreadsheet "${name}" not found in Drive.`, node.line);
      spreadsheetId = file.id;
    }

    const interp = this;

    // Return a Map-like handle with read/write methods
    const handle = new Map();
    handle.set('__type__', 'sheets');
    handle.set('__id__', spreadsheetId);
    handle.set('__name__', name);

    // handle.read("A1:C10") → 2D list
    handle.set('read', async (range) => {
      const r = encodeURIComponent(String(range));
      const data = await interp._googleAPI(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${r}`
      );
      return data?.values ?? [];
    });

    // handle.write("A1", value) or handle.write("A1:B2", [[...],[...]])
    handle.set('write', async (range, value) => {
      const r = encodeURIComponent(String(range));
      const body = Array.isArray(value) ? value : [[value]];
      await interp._googleAPI(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${r}?valueInputOption=USER_ENTERED`,
        { method: 'PUT', body: JSON.stringify({ values: body }) }
      );
      return value;
    });

    // handle.append(row) — appends a row to the first sheet
    handle.set('append', async (row) => {
      const body = Array.isArray(row[0]) ? row : [row];
      await interp._googleAPI(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: 'POST', body: JSON.stringify({ values: body }) }
      );
      return row;
    });

    return handle;
  }

  // ── wait block: Level 1 polling execution ────────────────────────────────
  async _executeWaitBlock(node, env) {
    const POLL_MS = 5000;  // poll every 5 seconds
    const MAX_POLLS = 720;   // give up after 1 hour (720 × 5s)
    const trigger = node.trigger;
    const interp = this;

    const poll = async () => {
      if (trigger === 'email') {
        // Poll Gmail for unread messages, optionally filtered by sender (by) and subject/other filters
        const from = node.source ? String(await this._interp.evalExpr(node.source, env)) : '';
        let q = `is:unread${from ? ` from:${from}` : ''}`;

        // Apply subject filter to Gmail query if provided
        const filters = node.filters ?? {};
        if (filters.subject) {
          const subjectFilter = String(await this._interp.evalExpr(filters.subject, env));
          q += ` subject:${subjectFilter}`;
        }

        const data = await this._googleAPI(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=1`
        );
        if (data?.messages?.length > 0) {
          const msg = await this._googleAPI(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${data.messages[0].id}`
          );
          const headers = msg?.payload?.headers ?? [];
          const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
          const fromAddr = headers.find(h => h.name === 'From')?.value ?? '';
          const bodyPart = msg?.payload?.parts?.[0]?.body?.data ?? msg?.payload?.body?.data ?? '';
          const bodyText = bodyPart ? atob(bodyPart.replace(/-/g, '+').replace(/_/g, '/')) : '';
          const msgId = data.messages[0].id;

          // Apply any remaining filters that couldn't be passed to Gmail API
          for (const [key, valNode] of Object.entries(filters)) {
            if (key === 'subject') continue; // already applied above
            const expected = String(await this._interp.evalExpr(valNode, env));
            const actual = key === 'from' ? fromAddr : key === 'body' ? bodyText : '';
            if (!actual.includes(expected)) return null;
          }

          const triggerEnv = env.child();

          // Implicit bindings — directly accessible by name in the block
          triggerEnv.set('subject', subject);
          triggerEnv.set('sender', fromAddr);
          triggerEnv.set('body', bodyText);
          triggerEnv.set('id', msgId);

          return triggerEnv;
        }
        return null;
      }

      if (trigger === 'sheets') {
        // Poll a sheet for new rows since last check
        const name = node.source ? String(await this._interp.evalExpr(node.source, env)) : '';
        const handle = await this._evalSheetsOpenExpr({ ...node, name: node.source }, env);
        const rows = await handle.get('read')('A1:Z1000');
        const lastSeen = this._interp.globals.get('__waitSheetRows__') ?? 0;
        const current = (rows?.length ?? 1) - 1; // subtract header
        if (current > lastSeen) {
          this._interp.globals.set('__waitSheetRows__', current);
          const newRows = rows.slice(lastSeen + 1);
          const triggerEnv = env.child();
          triggerEnv.set('rows', newRows);
          return triggerEnv;
        }
        // Initialise baseline on first poll
        if (lastSeen === 0) this._interp.globals.set('__waitSheetRows__', current);
        return null;
      }

      if (trigger === 'time') {
        // Check if current time matches (simple HH:MM match)
        const timeStr = node.source ? String(await this._interp.evalExpr(node.source, env)) : '';
        const now = new Date();
        const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (nowStr === timeStr) return env.child();
        return null;
      }

      return null;
    };

    this._interp.onOutput?.(`⏳ Waiting for ${trigger} trigger…`);

    let polls = 0;
    while (polls < MAX_POLLS) {
      const triggerEnv = await poll();
      if (triggerEnv) {
        this._interp.onOutput?.(`✓ ${trigger} trigger fired`);
        const r = await this._interp.execBlock(node.body, triggerEnv);
        if (r instanceof EndSignal || r instanceof ReturnSignal) return r;
        return;
      }
      polls++;
      await new Promise(res => setTimeout(res, POLL_MS));
    }

    this._interp.onOutput?.(`⚠ wait ${trigger}: timed out after ${MAX_POLLS * POLL_MS / 1000}s`);
  }

}

// ── Resolve a function parameter value (handles defaults and transforms) ──────
async function resolveParam(param, incoming, env, interp) {
  if (typeof param === 'string') return { name: param, value: incoming ?? NONE };
  const { name, lazy, defaultExpr, transformOp, transformRight } = param;
  let value;
  if (incoming !== undefined && incoming !== NONE) { value = incoming; }
  else if (defaultExpr) { value = await interp.evalExpr(defaultExpr, env); }
  else if (lazy) { value = transformOp ? 0 : NONE; }
  else { value = NONE; }
  if (transformOp && transformRight) {
    const right = await interp.evalExpr(transformRight, env);
    switch (transformOp) {
      case '+': value = value + right; break;
      case '-': value = value - right; break;
      case '*': value = value * right; break;
      case '/': value = right !== 0 ? value / right : NONE; break;
      case '//': value = right !== 0 ? Math.floor(value / right) : NONE; break;
      case '%': value = value % right; break;
      case '^': value = Math.pow(value, right); break;
    }
  }
  return { name, value };
}


// ── Immutability inference ────────────────────────────────────────────────────
// Scan AST to find variables that are assigned exactly once and never
// reassigned — these are inferred immutable (const).
// Returns a Set of variable names that are safe to treat as const.
function inferImmutables(ast) {
  const assigned = new Map(); // name → count of assignments
  const mutated = new Set(); // names that are explicitly mutated (make x + 1 shorthand)

  function scanExpr(node) {
    if (!node) return;
    if (node.type === 'Identifier') return;
    if (node.type === 'BinOp') { scanExpr(node.left); scanExpr(node.right); return; }
    if (node.type === 'UnaryOp') { scanExpr(node.operand); return; }
    if (node.type === 'Convert') { scanExpr(node.expr); return; }
    if (node.type === 'Call') { node.args?.forEach(scanExpr); return; }
    if (node.type === 'Invoke') { scanExpr(node.callee); node.args?.forEach(scanExpr); return; }
    if (node.type === 'MemberAccess') { scanExpr(node.object); return; }
    if (node.type === 'IndexAccess') { scanExpr(node.target); scanExpr(node.index); return; }
    if (node.type === 'ListLit') { node.elements?.forEach(scanExpr); return; }
    if (node.type === 'DictLit') { node.pairs?.forEach(p => { scanExpr(p.key); scanExpr(p.value); }); return; }
  }

  function scanBlock(stmts) {
    if (!stmts) return;
    for (const node of stmts) scanStmt(node);
  }

  function scanStmt(node) {
    if (!node) return;
    if (node.type === 'Assign') {
      const name = node.name;
      if (name) {
        // Shorthand reassign (make x + 1) — the expr references name as implied left
        // Detect: BinOp where left is Identifier with same name, or implied shorthand
        const isShorthand = node.expr?.type === 'BinOp' &&
          node.expr.left?.type === 'Identifier' &&
          node.expr.left.name === name;
        const isMemberTarget = node.target?.type === 'MemberAccess';
        const isLazy = node.lazy;

        if (isShorthand || isLazy) {
          mutated.add(name);
        } else if (!isMemberTarget) {
          assigned.set(name, (assigned.get(name) ?? 0) + 1);
          if ((assigned.get(name) ?? 0) > 1) mutated.add(name);
        }
      }
      scanExpr(node.expr);
      return;
    }
    if (node.type === 'If') {
      scanExpr(node.condition);
      scanBlock(node.body);
      scanBlock(node.else_);
      return;
    }
    if (node.type === 'Loop') { scanExpr(node.condition); scanBlock(node.body); return; }
    if (node.type === 'For') { scanBlock(node.body); return; }
    if (node.type === 'Fun') { scanBlock(node.body); return; }
    if (node.type === 'Class') { scanBlock(node.body); return; }
    if (node.type === 'Try') { scanBlock(node.body); scanBlock(node.errBody); return; }
    if (node.type === 'Print' || node.type === 'Text' || node.type === 'Give') { scanExpr(node.expr); return; }
    if (node.type === 'ExprStatement') { scanExpr(node.expr); return; }
    if (Array.isArray(node.body)) scanBlock(node.body);   // on / every / other blocks
  }

  scanBlock(ast.body);

  // A variable is immutable if assigned exactly once and never mutated
  const immutables = new Set();
  for (const [name, count] of assigned) {
    if (count === 1 && !mutated.has(name)) {
      immutables.add(name);
    }
  }
  return immutables;
}


class Interpreter {
  constructor(options = {}) {
    // I/O hooks — override these to wire up the browser UI
    this.onOutput = options.onOutput ?? (v => console.log(ivxRepr(v)));
    this.onInput = options.onInput ?? (() => { throw new RuntimeError("'take' requires an input handler"); });
    this.onError = options.onError ?? (e => console.error(e));
    this.onWait = options.onWait ?? (n => new Promise(r => setTimeout(r, n * 100)));
    // onStep(srcLine) — called before each statement executes with the 1-based source line
    this.onStep = options.onStep ?? null;
    this.onStatus = options.onStatus ?? null;
    this.screen = options.screen ?? null;   // DOM node the program's #elements go in
    this.onLive = options.onLive ?? null;   // told when the program starts/stops waiting for events
    this._elements = new Map();
    this._bindings = [];
    this._cleanups = [];
    this._queue = Promise.resolve();
    this.live = false;

    this.maxIterations = options.maxIterations ?? 100_000;

    this.globals = new Env();
    // Built-in: err starts as none
    this.globals.set('err', NONE);

    this._aborted = false;

    // Register built-in functions
    this._registerBuiltins();

    this.runtime = new IVXRuntime(this);
    this._immutables = new Set(); // populated before each run
    this._exprEvaluators = {
      NumberLit: (node, env) => this._evalNumberLit(node, env),
      StringLit: (node, env) => this._evalStringLit(node, env),
      BoolLit: (node, env) => this._evalBoolLit(node, env),
      Ask: (node, env) => this._evalAskExpr(node, env),
      SheetsOpen: (node, env) => this._evalSheetsOpenExpr(node, env),
      Super: (node, env) => this._evalSuperExpr(node, env),
      ListLit: (node, env) => this._evalListLit(node, env),
      DictLit: (node, env) => this._evalDictLit(node, env),
      MemberAccess: (node, env) => this._evalMemberAccessExpr(node, env),
      Identifier: (node, env) => this._evalIdentifierExpr(node, env),
      IndexAccess: (node, env) => this._evalIndexAccessExpr(node, env),
      LazyDecl: (node, env) => this._evalLazyDeclExpr(node, env),
      BinOp: (node, env) => this.evalBinOp(node, env),
      Post: (node, env) => this._evalPostExpr(node, env),
      Get: (node, env) => this._evalGetExpr(node, env),
      UnaryOp: (node, env) => this._evalUnaryOpExpr(node, env),
      Convert: async (node, env) => ivxConvert(this, node.conv, await this.evalExpr(node.expr, env), node),
      Call: (node, env) => this.evalCall(node, env),
      Invoke: (node, env) => this._evalInvokeExpr(node, env),
      Element: async (node) => this._element(node.name, node),
      ElementValue: async (node) => this._element(node.name, node).text,
    };
  }

  abort() {
    this._aborted = true;
    this.stop();
  }

  // End a running app: timers and event handlers stop, the Screen stays as it was.
  stop() {
    this._stopped = true;
    this._aborted = true;
    for (const f of this._cleanups.splice(0)) { try { f(); } catch (e) {} }
    if (this._endLive) { const r = this._endLive; this._endLive = null; r(); }
  }

  // Event handlers and timer ticks run one at a time, in the order they happened.
  _enqueue(task, line) {
    const run = this._queue.then(async () => {
      if (this._stopped) return;
      try { await task(); if (this._bindings.length) await this._refreshBindings(); }
      catch (e) {
        if (this._stopped) return;
        this.onError(e instanceof RuntimeError ? e : new RuntimeError(e && e.message ? e.message : String(e), line));
      }
    });
    this._queue = run;
    return run;
  }

  async _refreshBindings() {
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      for (const b of this._bindings.slice()) {
        let v;
        try { v = await this.evalExpr(b.expr, b.env); }
        catch (e) { this._bindings.splice(this._bindings.indexOf(b), 1); throw e; }
        const shown = typeof v === 'string' ? v : ivxRepr(FOREIGN.deep(v));
        if (shown !== b.last) { b.last = shown; b.element[b.prop] = v; }
      }
    } finally { this._refreshing = false; }
  }

  _element(name, node) {
    const el = this._elements.get(name);
    if (!el) throw new RuntimeError(`There's no #${name} on the screen`, node && node.line);
    return el;
  }

  // ── Execute a block of statements ─────────────────────────────────────────
  async execBlock(stmts, env) {
    for (const stmt of stmts) {
      if (!stmt) continue;
      const result = await this.execStmt(stmt, env);
      if (this._bindings.length && !this._refreshing) await this._refreshBindings();
      // Propagate control flow signals up
      if (result instanceof ReturnSignal) return result;
      if (result instanceof BreakSignal) return result;
      if (result instanceof ContinueSignal) return result;
      if (result instanceof EndSignal) return result;
    }
  }

  // ── Execute a single statement ────────────────────────────────────────────
  async execStmt(node, env) {
    try { return await this._execStmt(node, env); }
    catch (e) { if (e && e instanceof RuntimeError && !(e.line > 0) && node && node.line > 0) e.line = node.line; throw e; }
  }
  async _execStmt(node, env) {
    if (this._aborted) throw new RuntimeError('Execution stopped by user', node?.line);
    // Fire onStep so the renderer can highlight the active node
    if (this.onStep && node.line != null) this.onStep(node.line);
    switch (node.type) {

      case 'Assign': {
        // Lazy declaration: make name? + expr — hoist to global if not exists
        // Default is 0 for arithmetic context (most common), none otherwise
        if (node.lazy && node.name && !this.globals.has(node.name)) {
          // Peek at the expr to infer a better default
          // BinOp with arithmetic op on an Identifier named same as node.name
          // means the implied left is already set; infer from the right side
          let defaultVal = 0; // arithmetic shorthand implies integer
          if (node.expr?.type === 'BinOp') {
            const right = node.expr.right;
            if (right?.type === 'NumberLit') {
              defaultVal = Number.isInteger(right.value) ? 0 : 0.0;
            } else if (right?.type === 'StringLit') {
              defaultVal = '';
            } else if (right?.type === 'BoolLit') {
              defaultVal = false;
            }
          }
          this.globals.set(node.name, defaultVal);
        }
        const value = await this.evalExpr(node.expr, env);
        if (node.target?.type === 'MemberAccess') {
          const obj = await this.evalExpr(node.target.object, env);
          if (obj instanceof Map) {
            obj.set(node.target.field, value);
          } else if (obj && typeof obj === 'object') {
            obj[node.target.field] = value;
          } else {
            throw new RuntimeError(`You can only set '.${node.target.field}' on an object (for example self inside a class).`, node.line);
          }
        } else {
          if (this._immutables?.has(node.name)) {
            env.setConst(node.name, value);
          } else {
            env.set(node.name, value);
          }
        }
        break;
      }

      case 'Delete': {
        if (!env.del(node.name)) {
          throw new RuntimeError(`Can't delete '${node.name}' — it doesn't exist`, node.line);
        }
        break;
      }

      case 'Print':
      case 'Text': {
        let value = FOREIGN.deep(await this.evalExpr(node.expr, env));
        if (FOREIGN.isPy(value)) value = FOREIGN.repr(value);
        await this.onOutput(value);
        break;
      }

      case 'Speak': {
        const value = FOREIGN.deep(await this.evalExpr(node.expr, env));
        const text = typeof value === 'string' ? value : ivxRepr(value);
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          const utt = new SpeechSynthesisUtterance(text);
          await new Promise(resolve => {
            utt.onend = resolve;
            utt.onerror = resolve;
            window.speechSynthesis.speak(utt);
          });
        }
        await this.onOutput('🔊 ' + text);
        break;
      }

      case 'Take': {
        const raw = await this.onInput(node.name);
        let value = raw ?? NONE;
        // Apply converter if specified
        if (node.converter && value !== NONE) value = ivxConvert(this, node.converter, value, node);
        env.set(node.name, value);
        break;
      }

      case 'Give': {
        const value = await this.evalExpr(node.expr, env);
        return new ReturnSignal(value);
      }

      case 'Use': {
        // use <key> — set global credential
        const keyVal = await this.evalExpr(node.key, env);
        this.globals.set('__credential__', String(keyVal));
        break;
      }

      case 'UseCred': {
        const name = await this.evalExpr(node.name, env);
        const stored = window.IVX?.credentials?.get(String(name));
        if (!stored) {
          throw new RuntimeError(
            `Credential "${name}" not found — add it in the 🔑 Credentials panel`,
            node.line
          );
        }
        this.globals.set('__credName__', String(name));
        this.globals.set('__credBase__', stored.baseUrl ?? null);
        this.globals.set('__credential__', stored.value); // backwards compat for ask
        break;
      }

      case 'Get': {
        const result = await this.runtime._executeGet(node, env);
        this.globals.set('response', result);
        break;
      }

      case 'Post': {
        // post <url> <body> [use <key>]
        // Result stored in 'response' by default, or assign via make response post ...
        return await this._executePost(node, env, { storeResponse: true });
      }

      case 'Save': {
        await this._executeSave(node, env);
        break;
      }

      case 'TakeFile': {
        // take file.csv — browser file picker
        const result = await new Promise((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          const extMap = { csv: '.csv', json: '.json', txt: '.txt', tsv: '.tsv', xml: '.xml' };
          input.accept = extMap[node.ext] || '*';
          input.onchange = async () => {
            const file = input.files[0];
            if (!file) { resolve(NONE); return; }
            const text = await file.text();
            try {
              if (node.ext === 'json') {
                resolve(JSON.parse(text));
              } else if (node.ext === 'csv' || node.ext === 'tsv') {
                const sep = node.ext === 'tsv' ? '\t' : ',';
                const lines = text.trim().split('\n');
                const headers = lines[0].split(sep).map(h => h.trim());
                const rows = lines.slice(1).map(line => {
                  const vals = line.split(sep);
                  const row = new Map();
                  headers.forEach((h, i) => row.set(h, vals[i]?.trim() ?? ''));
                  return row;
                });
                resolve(rows);
              } else {
                resolve(text);
              }
            } catch (e) {
              reject(new RuntimeError(`Failed to parse ${node.ext}: ${e.message}`, node.line));
            }
          };
          input.click();
        });
        env.set(node.name, result);
        break;
      }

      case 'Wait': {
        if (node.condition) {
          // wait x = 5 — poll until condition is true
          let iters = 0;
          while (true) {
            const cond = await this.evalExpr(node.condition, env);
            if (cond) break;
            if (++iters > this.maxIterations) {
              throw new RuntimeError("'wait' condition never became true", node.line);
            }
            await this.onWait(1);
          }
        } else {
          const cycles = await this.evalExpr(node.expr, env);
          if (node.unitMs) await new Promise(r => setTimeout(r, Math.max(0, Number(cycles) * node.unitMs)));
          else await this.onWait(Number(cycles) || 1);
        }
        break;
      }

      case 'WaitBlock': {
        // WaitBlock is a declaration — deployed to Apps Script automatically.
        // The browser never executes it directly, just like 'fun' doesn't run its body.
        break;
      }

      case 'If': {
        const cond = await this.evalExpr(node.condition, env);
        const bodyEnv = env.child();
        if (isTruthy(cond)) {
          const r = await this.execBlock(node.body, bodyEnv);
          if (r) return r;
        } else if (node.else_) {
          const elseEnv = env.child();
          const r = await this.execBlock(node.else_, elseEnv);
          if (r) return r;
        }
        break;
      }

      case 'Loop': {
        let iters = 0;
        while (true) {
          // Re-fire onStep so the Decision node highlights on every iteration
          if (this.onStep && node.line != null) this.onStep(node.line);
          const cond = await this.evalExpr(node.condition, env);
          if (!isTruthy(cond)) break;
          if (++iters > this.maxIterations) {
            throw new RuntimeError('This loop ran too many times and was stopped -- it may never end. Make sure something inside it changes what the loop checks, or use next to leave.', node.line);
          }
          const loopEnv = env.child();
          const r = await this.execBlock(node.body, loopEnv);
          // Yield to browser UI thread
          await new Promise(r => setTimeout(r, 0));
          if (r instanceof ReturnSignal) return r;
          if (r instanceof BreakSignal) break;
        }
        break;
      }

      case 'For': {
        let iterable;
        if (node.targetExpr) {
          iterable = await this.evalExpr(node.targetExpr, env);
        } else {
          iterable = env.get(node.target);
          if (iterable === undefined) {
            throw new RuntimeError(`'${node.target}' isn't defined yet — use make to create it first`, node.line);
          }
        }
        iterable = FOREIGN.deep(iterable);
        if (FOREIGN.isPy(iterable)) {
          try { iterable = Array.from(iterable, FOREIGN.fromPy); } catch (e) { throw new RuntimeError("That Python object can't be stepped through with each", node.line); }
        } else if (FOREIGN.isJsForeign(iterable) && typeof iterable[Symbol.iterator] === 'function') {
          iterable = Array.from(iterable, FOREIGN.fromJS);
        }
        const entries = toIterable(iterable, node);
        let iters = 0;
        for (const [primary, secondary] of entries) {
          // Re-fire onStep so the Decision node highlights on every iteration
          if (this.onStep && node.line != null) this.onStep(node.line);
          if (++iters > this.maxIterations) {
            throw new RuntimeError('This loop ran too many times and was stopped. If you meant it to be that long, try a smaller number.', node.line);
          }
          const forEnv = env.child();
          forEnv.define(node.iterVar, primary);
          forEnv.define(node.iterVar2, secondary);
          const r = await this.execBlock(node.body, forEnv);
          // Yield to browser UI thread
          await new Promise(r => setTimeout(r, 0));
          if (r instanceof ReturnSignal) return r;
          if (r instanceof BreakSignal) break;
        }
        break;
      }

      case 'Fun': {
        const fn = new IVXFunction(node.name, node.params, node.body, env);
        env.set(node.name, fn);
        break;
      }

      case 'Class': {
        const superClass = node.superclass
          ? this._resolveClassObject(node.superclass.name, env)
          : null;
        if (node.superclass && !superClass) {
          throw new RuntimeError(`'${node.superclass.name}' isn't defined — check the class name`, node.superclass.line, node.superclass.col);
        }
        const cls = new IVXClass(node.name, node.body, env, superClass);
        const classEnv = env.child();
        classEnv.define('self', NONE);
        if (superClass) {
          classEnv.define('super', new IVXSuperProxy(NONE, cls));
        }
        for (const stmt of node.body ?? []) {
          if (stmt?.type === 'Fun') {
            const methodFn = new IVXFunction(stmt.name, stmt.params, stmt.body, classEnv);
            methodFn.__ownerClass = cls;
            if (stmt.extendParent) methodFn.__extendParent = true;
            cls.methods.set(stmt.name, methodFn);
          } else if (stmt) {
            cls.initStmts.push(stmt);
          }
        }
        env.set(node.name, cls);
        break;
      }

      case 'Try': {
        try {
          const result = await this.execBlock(node.body, env);
          if (result instanceof ReturnSignal || result instanceof EndSignal) return result;
        } catch (e) {
          const msg = e instanceof RuntimeError ? e.message : (e?.message ?? String(e));
          const errEnv = env.child();
          errEnv.define(node.errVar ?? 'err', msg);
          this.globals.set('err', msg);
          if (node.errBody?.length) {
            const result = await this.execBlock(node.errBody, errEnv);
            if (result instanceof ReturnSignal || result instanceof EndSignal) return result;
          }
        }
        break;
      }

      case 'End': {
        if (node.stmt) await this.execStmt(node.stmt, env);
        return new EndSignal();
      }

      case 'Dot':
        // Connector — no-op at runtime
        break;

      case 'Import': {
        if (!node.url) break;
        let url = node.url;
        if (url.startsWith('http:')) throw new RuntimeError("Insecure protocol: HTTPS is mandatory for KH modules.", node.line);
        if (!url.startsWith('http')) url = 'https://' + url;

        try {
          const src = await this._fetchPinned(url, node);
          const modEnv = this.globals.child();
          const parsed = parse(src);
          await this.execBlock(parsed.ast.body, modEnv);
          if (node.names && node.names.length > 0) {
            for (const name of node.names) {
              const val = modEnv.get(name);
              if (val === undefined) throw new RuntimeError(`This module doesn't have '${name}' — check the spelling or the module docs`, node.line);
              env.set(name, val);
            }
          } else {
            for (const [k, v] of modEnv.vars) env.set(k, v);
          }
        } catch (e) {
          throw new RuntimeError(`Import failed from ${node.url}: ${e.message}`, node.line);
        }
        break;
      }

      case 'Library': {
        const status = (msg) => { try { this.onStatus && this.onStatus(msg); } catch (e) {} };
        FOREIGN.out = (line) => this.onOutput(line);
        const spec = node.spec;
        const lower = spec.toLowerCase().split(/[?#]/)[0];
        let kind = node.lang;
        if (!kind) kind = /\.(m?js)$/.test(lower) ? 'js' : /\.py$/.test(lower) ? 'python' : 'mutter';
        // name to bind: what follows 'as', else the package's last part (date-fns -> date_fns, os.path -> path)
        let name = node.alias;
        if (!name) {
          let base = spec.replace(/[?#].*$/, '').replace(/\/+$/, '');
          base = base.split('/').pop();
          if (kind !== 'python' || node.isUrl) base = base.replace(/\.(m?js|py|vx|mutter|kh|txt)$/i, '');
          base = base.replace(/@.*$/, '').replace(/[=<>~].*$/, '');
          if (kind === 'python' && !node.isUrl) base = base.split('.').pop();
          name = base.replace(/[^A-Za-z0-9_]/g, '_');
          if (/^[0-9]/.test(name)) name = '_' + name;
          if (KEYWORDS.has(name)) {
            throw new RuntimeError(`'${name}' is a Mutter word, so it can't be the package's name here. Write: use ${node.lang ? node.lang + ' ' : ''}${spec} as ${name}_lib`, node.line);
          }
        }
        if (kind === 'mutter') {
          let url = spec;
          if (url.startsWith('http:')) throw new RuntimeError("Use an https:// address -- plain http isn't allowed for code.", node.line);
          try {
            const src = await this._fetchPinned(url, node);
            const modEnv = this.globals.child();
            const parsed = parse(src);
            if (parsed.errors && parsed.errors.length) throw new Error(`line ${parsed.errors[0].line} of that file: ${parsed.errors[0].message}`);
            await this.execBlock(parsed.ast.body, modEnv);
            if (node.alias) {
              const ns = new Map();
              for (const [k, v] of modEnv.vars) ns.set(k, v);
              env.set(name, ns);
            } else {
              for (const [k, v] of modEnv.vars) env.set(k, v);
            }
          } catch (e) {
            if (e instanceof RuntimeError && /changed since/.test(e.message)) throw e;
            throw new RuntimeError(`Couldn't use ${spec}: ${e.message}`, node.line);
          }
          break;
        }
        try {
          let mod;
          if (kind === 'python') {
            mod = node.isUrl ? await FOREIGN.importPythonSource(spec, name, status) : await FOREIGN.importPython(spec, status);
          } else {
            mod = await FOREIGN.importJS(spec);
          }
          env.set(name, mod);
        } catch (e) {
          throw new RuntimeError(`Couldn't use ${kind === 'python' ? 'the Python' : 'the JavaScript'} package '${spec}': ${FOREIGN.errText(e)}`, node.line);
        }
        break;
      }

      case 'On': {
        const el = node.target ? this._element(node.target, node) : null;
        const domEvent = node.event === 'key' ? 'keydown' : ELEMENT_EVENTS[node.event];
        const host = el ? el.dom : document;
        const listener = (ev) => {
          if (node.event === 'enter' && ev.key !== 'Enter') return;
          if (node.event === 'key' && ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName) && !(ev.target.classList && ev.target.classList.contains('mu-el'))) return;
          const keyName = ev.key;
          this._enqueue(async () => {
            const henv = this.globals.child();
            if (node.event === 'key' || node.event === 'enter') henv.define('key', keyName);
            await this.execBlock(node.body, henv);
          }, node.line);
        };
        host.addEventListener(domEvent, listener);
        this._cleanups.push(() => host.removeEventListener(domEvent, listener));
        break;
      }

      case 'Every': {
        const amount = Number(await this.evalExpr(node.expr, env));
        if (!Number.isFinite(amount) || amount <= 0) throw new RuntimeError("'every' needs a positive amount of time, like every 1 second", node.line);
        const ms = Math.max(16, amount * node.unitMs);
        let pending = false;
        const id = setInterval(() => {
          if (pending) return;          // don't pile up ticks if the last one is still running
          pending = true;
          this._enqueue(async () => {
            try { await this.execBlock(node.body, this.globals.child()); } finally { pending = false; }
          }, node.line);
        }, ms);
        this._cleanups.push(() => clearInterval(id));
        break;
      }

      case 'Bind': {
        const el = this._element(node.target.object.name, node);
        const prop = node.target.field;
        if (!(prop in el) || typeof el[prop] === 'function') throw new RuntimeError(`#${el.name} has no '${prop}' to bind. Use text, color, background, size or visible`, node.line);
        this._bindings.push({ element: el, prop, expr: node.expr, env, last: undefined });
        break;
      }

      case 'Jump': return new ContinueSignal();   // restart top of loop header
      case 'Next': return new BreakSignal();      // exit loop
      case 'Stop': {
        let msg = 'Stopped by script';
        if (node.stmt) {
          const res = await this.evalExpr(node.stmt.expr ?? node.stmt, env);
          if (res) msg = String(res);
        }
        throw new RuntimeError(msg, node.line);
      }
      case 'Pin': break;                          // visual anchor, no-op
      case 'ExprStatement':
        if (node.expr) await this.evalExpr(node.expr, env);
        break;

      default:
        break;
    }
  }

  // ── Evaluate an expression to a value ─────────────────────────────────────
  async evalExpr(node, env) {
    if (!node) return NONE;
    const evaluator = this._exprEvaluators[node.type];
    if (!evaluator) return NONE;
    return await evaluator(node, env);
  }

  async _evalNumberLit(node) {
    return node.value;
  }

  async _evalStringLit(node, env) {
    let sv = node.value;

    if (typeof sv === 'string' && sv.includes('{')) {
      const parts = [];
      let i = 0;
      while (i < sv.length) {
        const open = sv.indexOf('{', i);
        if (open === -1) { parts.push(sv.slice(i)); break; }
        parts.push(sv.slice(i, open));
        const close = sv.indexOf('}', open);
        if (close === -1) { parts.push(sv.slice(open)); break; }
        const expr = sv.slice(open + 1, close).trim();
        try {
          const parsed = parse(expr + '\n');
          if (parsed.ast?.body?.length > 0) {
            const exprNode = parsed.ast.body[0]?.expr ?? parsed.ast.body[0];
            if (exprNode) { parts.push(ivxRepr(await this.evalExpr(exprNode, env))); }
            else { parts.push('{' + expr + '}'); }
          } else { parts.push('{' + expr + '}'); }
        } catch { parts.push(ivxRepr(env.get(expr)) ?? '{' + expr + '}'); }
        i = close + 1;
      }
      sv = parts.join('');
    }
    if (typeof sv === 'string' && (sv.startsWith('http://') || sv.startsWith('https://'))) {
      try {
        const res = await fetch(sv);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) return await res.json();
        return await res.text();
      } catch (e) {
        throw new RuntimeError(`fetch failed for ${sv}: ${e.message}`, node.line);
      }
    }
    return sv;
  }

  async _evalBoolLit(node) {
    return node.value;
  }



  // ── Execute a program from source ─────────────────────────────────────────
  async run(source, options = {}) {
    let parsed;
    try {
      parsed = parse(source);
    } catch (e) {
      console.error("[IVX] Parse crash:", e);
      this.onError(new RuntimeError(`Parser crashed: ${e.message}`, 0));
      return;
    }
    const { errors: typeErrors } = typecheck(parsed);

    const hasParseErrors = parsed.errors.length > 0;
    if (typeErrors.length > 0 && (hasParseErrors || !options.ignoreTypeErrors)) {
      for (const e of typeErrors) this.onError(e);
      return;
    }
    // Infer immutable variables before execution
    this._immutables = inferImmutables(parsed.ast);
    const wanted = scanElements(parsed.ast.body);
    if (this.screen) { this.screen.innerHTML = ''; this.screen.hidden = wanted.length === 0; }
    try {
      for (const { name, kind } of wanted) {
        const el = new IVXElement(name, kind);
        this._elements.set(name, el);
        if (this.screen) this.screen.appendChild(el.dom);
      }
    } catch (e) {
      if (e instanceof RuntimeError) { this.onError(e); return; }
      throw e;
    }
    let failed = false;
    const main = this._queue.then(async () => {
      try {
        await this.execBlock(parsed.ast.body, this.globals);
      } catch (e) {
        failed = true;
        if (e instanceof RuntimeError) { if (!this._stopped) this.onError(e); }
        else throw e;
      }
    });
    this._queue = main;
    await main;
    if (this._cleanups.length && !failed && !this._stopped) {
      // the program set up 'on' handlers or 'every' timers: keep running until Stop
      this.live = true;
      if (this.onLive) this.onLive(true);
      await new Promise(resolve => { this._endLive = resolve; });
      this.live = false;
      if (this.onLive) this.onLive(false);
    } else if (failed) {
      this.stop();
    }
  }

  _resolveClassObject(name, env = this.globals) {
    const value = env?.get?.(name);
    return value instanceof IVXClass ? value : null;
  }

  _bindMethod(methodFn, selfValue) {
    const bound = new IVXFunction(methodFn.name, methodFn.params, methodFn.body, methodFn.closure);
    bound.__ownerClass = methodFn.__ownerClass ?? null;
    bound.__boundSelf = selfValue;

    const ownerClass = methodFn.__ownerClass ?? null;
    if (ownerClass?.superclass) {
      bound.__boundSuper = new IVXSuperProxy(selfValue, ownerClass);
    }

    return bound;
  }

  _resolveInstanceMember(instance, field, selfValue = instance) {
    if (!(instance instanceof Map)) return NONE;
    if (instance.has(field)) return instance.get(field);

    const classObj = instance.get('__class_obj__');
    const method = classObj?.resolveMethod?.(field) ?? null;
    if (method) {
      return this._bindMethod(method, selfValue);
    }

    return NONE;
  }

  _resolveSuperMember(proxy, field) {
    if (!(proxy instanceof IVXSuperProxy)) return NONE;
    const superClass = proxy.ownerClass?.superclass ?? null;
    const method = superClass?.resolveMethod?.(field) ?? null;
    if (method) return this._bindMethod(method, proxy.self);
    return NONE;
  }

  // ── Built-in functions ────────────────────────────────────────────────────
  _registerBuiltins() {
    // Only the standard library is a global name; the rest of BUILTIN_DEFS backs methods (s.upper) and 'as'.
    const G = this.globals;
    for (const [name, internal] of Object.entries(STANDARD_LIBRARY)) {
      G.set(name, new IVXFunction(internal, BUILTIN_DEFS[internal].params, null, null));
    }
  }

  // ── Call a built-in function by name ──────────────────────────────────────
  _callBuiltin(name, args, node) {
    const spec = BUILTIN_DEFS[name];
    if (!spec) throw new RuntimeError(`Unknown built-in '${name}'`, node?.line);
    return spec.call(args, node, this);
  }


  // ── I/O delegation — all side effects live in IVXRuntime ─────────────────
  async _executePost(node, env, opts) { return this.runtime._executePost(node, env, opts); }
  async _executeGet(node, env) { return this.runtime._executeGet(node, env); }
  async _saveLocalFile(f, c, m) { return this.runtime._saveLocalFile(f, c, m); }
  async _saveDriveFile(f, c, m) { return this.runtime._saveDriveFile(f, c, m); }
  _ivxToPlain(v) { return this.runtime._ivxToPlain(v); }
  _escapeDelimitedCell(v, d) { return this.runtime._escapeDelimitedCell(v, d); }
  _toDelimitedText(v, d) { return this.runtime._toDelimitedText(v, d); }
  _serializeForSave(v, f) { return this.runtime._serializeForSave(v, f); }
  async _evalAskExpr(node, env) { return this.runtime._evalAskExpr(node, env); }
  async _evalSheetsOpenExpr(node, env) { return this.runtime._evalSheetsOpenExpr(node, env); }
  async _executeWaitBlock(node, env) { return this.runtime._executeWaitBlock(node, env); }


  async _evalListLit(node, env) {
    const elements = [];
    for (const el of node.elements) elements.push(await this.evalExpr(el, env));
    return elements;
  }

  async _evalDictLit(node, env) {
    const map = new Map();
    for (const { key, value } of node.pairs) {
      const k = await this.evalExpr(key, env);
      const v = await this.evalExpr(value, env);
      map.set(k, v);
    }
    return map;
  }

  async _fetchPinned(url, node) {
    if (url.startsWith('http:')) throw new RuntimeError("Use an https:// address -- plain http isn't allowed for code.", node.line);
    if (!url.startsWith('http')) url = 'https://' + url;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const src = await res.text();
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    const currentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const storageKey = `kh_hash_${url}`;
    let storedHash = null;
    try { storedHash = localStorage.getItem(storageKey); } catch (e) {}
    if (!storedHash) {
      try { localStorage.setItem(storageKey, currentHash); } catch (e) {}
    } else if (storedHash !== currentHash) {
      throw new RuntimeError(`Security block: the code at ${url} has changed since you first used it. If you trust the new version, use a versioned address or clear this site's saved data.`, node.line);
    }
    return src;
  }

  async _evalMemberAccessExpr(node, env) {
    let target = await this.evalExpr(node.object, env);
    if (FOREIGN.isPy(target)) {
      const d = FOREIGN.deep(target);
      if ((Array.isArray(d) && LIST_METHODS[node.field]) || (typeof d === 'string' && TEXT_METHODS[node.field]) || ((Array.isArray(d) || typeof d === 'string') && !(node.field in target))) target = d;
    }
    if (typeof target === 'string' || Array.isArray(target)) {
      // bare text / list method with no arguments: name.upper, items.sort, items.length
      const own = typeof target === 'string' ? TEXT_METHODS[node.field] : LIST_METHODS[node.field];
      if (own) return own(target, [], node);
      if (Object.prototype.hasOwnProperty.call(BUILTIN_DEFS, node.field)) return this._callBuiltin(node.field, [target], node);
      return NONE;
    }
    if (isPlainDict(target) && !target.has(node.field) && DICT_METHODS[node.field]) return DICT_METHODS[node.field](target, []);
    const m = this._memberOf(target, node.field);
    if (m instanceof IVXFunction) return this._applyCallee(m, [], node);   // rex.speak runs it
    if (FOREIGN.isPy(m)) {
      let t = '';
      try { t = m.type; } catch (e) {}
      if (t === 'method' || t === 'builtin_function_or_method' || t === 'function' || t === 'method-wrapper') return this._applyCallee(m, [], node);
      return m;
    }
    if (typeof m === 'function' && FOREIGN.isJsForeign(target) && !FOREIGN.isClassFn(m)) {
      return this._applyCallee(m.bind(target), [], node);   // a package's function with no arguments runs too
    }
    return m;
  }

  _memberOf(target, field) {
    if (target instanceof IVXSuperProxy) {
      return this._resolveSuperMember(target, field);
    }
    if (target instanceof Map) {
      return this._resolveInstanceMember(target, field, target);
    }
    if (FOREIGN.isPy(target)) {
      let v;
      try { v = target[field]; } catch (e) { throw new RuntimeError(FOREIGN.errText(e)); }
      return FOREIGN.fromPy(v);
    }
    if (target && (typeof target === 'object' || typeof target === 'function')) {
      return field in target ? FOREIGN.fromJS(target[field]) : NONE;
    }
    return NONE;
  }

  async _evalSuperExpr(node, env) {
    const target = env.get('super');
    if (target instanceof IVXSuperProxy) return target;
    throw new RuntimeError(`'take.' (the parent class) only works inside a subclass method`, node.line, node.col);
  }

  async _evalIdentifierExpr(node, env) {
    const val = env.get(node.name);
    if (val instanceof IVXFunction) return this._applyCallee(val, [], node);   // a bare function name runs it
    if (val === undefined && OLD_BUILTIN_HINTS[node.name] && !['index', 'size', 'len'].includes(node.name)) {
      throw new RuntimeError(`'${node.name}' isn't defined. If you meant the built-in, write: ${OLD_BUILTIN_HINTS[node.name]}`, node.line, node.col);
    }
    if (val === undefined) {
      throw new RuntimeError(((suggestWord(node.name) || '').replace("isn't a Vertex word.", "isn't defined yet.") || `'${node.name}' isn't defined yet. Did you mean to make it first?`), node.line, node.col);
    }
    return val;
  }

  async _evalInvokeExpr(node, env) {
    let callee;
    if (node.callee.type === 'MemberAccess') {
      let obj = await this.evalExpr(node.callee.object, env);
      if (FOREIGN.isPy(obj)) {
        const f = node.callee.field, d = FOREIGN.deep(obj);
        if ((Array.isArray(d) && LIST_METHODS[f]) || (typeof d === 'string' && TEXT_METHODS[f]) || ((Array.isArray(d) || typeof d === 'string') && !(f in obj))) obj = d;
      }
      if (typeof obj === 'string' || Array.isArray(obj)) {
        // method-style call on text or a list: name.upper(), items.join(", ")
        const margs = [];
        for (const arg of node.args) margs.push(await this.evalExpr(arg, env));
        const field = node.callee.field;
        const own = typeof obj === 'string' ? TEXT_METHODS[field] : LIST_METHODS[field];
        if (own) return own(obj, margs, node);
        if (Object.prototype.hasOwnProperty.call(BUILTIN_DEFS, field)) return this._callBuiltin(field, [obj, ...margs], node);
        throw new RuntimeError(`${typeof obj === 'string' ? 'Text' : 'A list'} has no '.${field}()' method. See the Guide for the list of text methods.`, node.line);
      }
      if (isPlainDict(obj) && !obj.has(node.callee.field) && DICT_METHODS[node.callee.field]) {
        const dargs = [];
        for (const arg of node.args) dargs.push(await this.evalExpr(arg, env));
        return DICT_METHODS[node.callee.field](obj, dargs);
      }
      callee = this._memberOf(obj, node.callee.field);
      if ((FOREIGN.isPy(obj) || FOREIGN.isJsForeign(obj)) && (callee === NONE || callee === undefined)) {
        throw new RuntimeError(`This package object has nothing called '${node.callee.field}'. Check the spelling (package names are case-sensitive).`, node.line);
      }
      if (typeof callee === 'function' && !FOREIGN.isPy(callee) && FOREIGN.isJsForeign(obj) && !FOREIGN.isClassFn(callee)) {
        callee = callee.bind(obj);
      }
    } else {
      callee = await this.evalExpr(node.callee, env);
    }
    const args = [];
    for (const arg of node.args) args.push(await this.evalExpr(arg, env));
    



    return this._applyCallee(callee, args, node);
  }

  async _applyCallee(callee, args, node) {
    if (callee instanceof IVXFunction) {
      if (callee.body === null) {
        try {
          return await this._callBuiltin(callee.name, args, node) ?? NONE;
        } catch (e) {
          this.globals.set('err', e.message ?? String(e));
          throw (e instanceof RuntimeError ? e : new RuntimeError(e?.message ?? String(e), (typeof node !== 'undefined' && node) ? node.line : 0));
        }
      }
      const fnEnv = callee.closure.child();
      if (callee.__boundSelf !== undefined) {
        fnEnv.define('self', callee.__boundSelf);
      }
      if (callee.__boundSuper !== undefined) {
        fnEnv.define('super', callee.__boundSuper);
      }
      for (let i = 0; i < callee.params.length; i++) {
        const { name: pn, value: pv } = await resolveParam(callee.params[i], args[i], fnEnv, this);
        fnEnv.define(pn, pv);
      }
      try {
        const result = await this.execBlock(callee.body, fnEnv);
        if (result instanceof ReturnSignal) return result.value;
        return NONE;
      } catch (e) {
        this.globals.set('err', e.message ?? String(e));
        throw (e instanceof RuntimeError ? e : new RuntimeError(e?.message ?? String(e), (typeof node !== 'undefined' && node) ? node.line : 0));
      }
    }

    if (callee instanceof IVXClass) {
      try {
        return await callee.instantiate(args, this, node);
      } catch (e) {
        this.globals.set('err', e.message ?? String(e));
        throw (e instanceof RuntimeError ? e : new RuntimeError(e?.message ?? String(e), (typeof node !== 'undefined' && node) ? node.line : 0));
      }
    }

    // Functions from packages (Python via Pyodide, or JavaScript)
    if (typeof callee === 'function') {
      try {
        if (FOREIGN.isPy(callee)) {
          let r = callee(...args.map(FOREIGN.toPy));
          if (r && typeof r.then === 'function') r = await r;
          return FOREIGN.fromPy(r);
        }
        const jsArgs = args.map(FOREIGN.toJS);
        let r;
        if (FOREIGN.isClassFn(callee)) r = new callee(...jsArgs);
        else {
          try { r = callee(...jsArgs); }
          catch (e) {
            if (e instanceof TypeError && /without 'new'|cannot be invoked|is not a constructor|requires 'new'/i.test(e.message)) r = new callee(...jsArgs);
            else throw e;
          }
        }
        if (r && typeof r.then === 'function') r = await r;
        return FOREIGN.fromJS(r);
      } catch (e) {
        if (e instanceof RuntimeError) throw new RuntimeError(e.message, e.line || node.line);
        throw new RuntimeError(FOREIGN.errText(e), node.line);
      }
    }

    throw new RuntimeError("You used ( ) on something that isn't a function. Only things made with define (or a class) can be called.", node.line);
  }

  _toArrayIndex(value, node, label) {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new RuntimeError(`${label} index must be an integer`, node?.line);
    }
    return n;
  }

  _toSliceBound(value, node, label) {
    if (value === null || value === undefined) return null;
    return this._toArrayIndex(value, node, label);
  }

  _toExcelColumnIndex(value) {
    if (typeof value !== 'string') return null;
    const col = value.trim().toUpperCase();
    if (!/^[A-Z]+$/.test(col)) return null;
    let out = 0;
    for (let i = 0; i < col.length; i++) {
      out = out * 26 + (col.charCodeAt(i) - 64);
    }
    return out - 1;
  }

  _parseExcelCellRef(value) {
    if (typeof value !== 'string') return null;
    const m = value.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    const col = this._toExcelColumnIndex(m[1]);
    const row = Number(m[2]);
    if (col == null || !Number.isInteger(row) || row < 0) return null;
    return { row, col };
  }

  _normalizeTableColumnSelector(value, node) {
    if (typeof value !== 'string') return value;
    const colIdx = this._toExcelColumnIndex(value);
    if (colIdx == null) {
      throw new RuntimeError(`Invalid table column '${value}'. Use Excel letters like A, B, AA`, node?.line);
    }
    return colIdx;
  }

  _sliceExcelRange(table, startRef, endRef) {
    const rowStart = Math.min(startRef.row, endRef.row);
    const rowEnd = Math.max(startRef.row, endRef.row);
    const colStart = Math.min(startRef.col, endRef.col);
    const colEnd = Math.max(startRef.col, endRef.col);
    const out = [];

    for (let r = rowStart; r <= rowEnd; r++) {
      const rowVal = table[r] ?? NONE;
      if (Array.isArray(rowVal)) {
        out.push(rowVal.slice(colStart, colEnd + 1));
      } else if (rowVal instanceof Map) {
        const rowOut = [];
        for (let c = colStart; c <= colEnd; c++) rowOut.push(rowVal.get(c) ?? NONE);
        out.push(rowOut);
      } else if (rowVal && typeof rowVal === 'object') {
        const rowOut = [];
        for (let c = colStart; c <= colEnd; c++) rowOut.push(rowVal[c] ?? NONE);
        out.push(rowOut);
      } else {
        out.push([]);
      }
    }

    return out;
  }

  _pickColumnFromRow(row, colIdxOrKey) {
    if (row == null) return NONE;
    if (row instanceof Map) {
      return row.has(colIdxOrKey) ? row.get(colIdxOrKey) : NONE;
    }
    if (Array.isArray(row)) {
      if (typeof colIdxOrKey === 'string') return NONE;
      return row[colIdxOrKey] ?? NONE;
    }
    if (typeof row === 'object') {
      return row[colIdxOrKey] ?? NONE;
    }
    return NONE;
  }

  _sliceColumnsFromRow(row, start, end) {
    if (Array.isArray(row)) return row.slice(start ?? undefined, end ?? undefined);
    return NONE;
  }

  async _resolveIndexSpec(spec, env, node, label, { allowString = false } = {}) {
    if (!spec || spec.omitted) return { omitted: true, isSlice: false, value: null, start: null, end: null };
    if (spec.isSlice) {
      const startRaw = spec.start ? await this.evalExpr(spec.start, env) : null;
      const endRaw = spec.end ? await this.evalExpr(spec.end, env) : null;

      const start = allowString && typeof startRaw === 'string'
        ? startRaw
        : this._toSliceBound(startRaw, node, `${label} start`);
      const end = allowString && typeof endRaw === 'string'
        ? endRaw
        : this._toSliceBound(endRaw, node, `${label} end`);

      return {
        omitted: false,
        isSlice: true,
        start,
        end,
      };
    }

    const raw = spec.expr ? await this.evalExpr(spec.expr, env) : null;
    if (allowString && typeof raw === 'string') {
      return { omitted: false, isSlice: false, value: raw, start: null, end: null };
    }
    return { omitted: false, isSlice: false, value: this._toArrayIndex(raw, node, label), start: null, end: null };
  }

  async _evalIndexAccessExpr(node, env) {
    let target = await this.evalExpr(node.target, env);
    if (FOREIGN.isPy(target)) {
      const d = FOREIGN.deep(target);
      if (!FOREIGN.isPy(d)) target = d;
      else if (node.rowSpec && !node.rowSpec.isSlice && !node.rowSpec.omitted && !node.hasComma) {
        const key = await this.evalExpr(node.rowSpec.expr, env);
        try { return FOREIGN.fromPy(target.get(FOREIGN.toPy(key))); }
        catch (e) { throw new RuntimeError(FOREIGN.errText(e), node.line); }
      }
    }
    const isArrayTarget = Array.isArray(target);

    const isSheet = target instanceof Map && target.get('__type__') === 'sheets';
    const row = await this._resolveIndexSpec(node.rowSpec, env, node, 'Row', { allowString: isArrayTarget || isSheet || target instanceof Map });
    const col = await this._resolveIndexSpec(node.colSpec, env, node, 'Column', { allowString: true });


    if (!isArrayTarget) {
      if (node.hasComma) {
        throw new RuntimeError(`2D indexing requires a list target`, node.line);
      }
      if (row.omitted) return target;

      if (row.isSlice) {
        // Magic: sheets_handle[A1:B10] -> handle.read("A1:B10")
        if (target instanceof Map && target.get('__type__') === 'sheets') {
          const range = `${row.start}:${row.end}`;
          return await target.get('read')(range);
        }
        if (typeof target === 'string') {
          return target.slice(row.start ?? undefined, row.end ?? undefined);
        }
        throw new RuntimeError(`Slice indexing requires list or string target`, node.line);
      }

      if (target instanceof Map) {
        // Magic: sheets_handle[A1] -> handle.read("A1")
        if (target.get('__type__') === 'sheets' && !target.has(row.value)) {
          const res = await target.get('read')(row.value);
          // If it's a single cell, unwrap it
          if (Array.isArray(res) && res.length === 1 && Array.isArray(res[0]) && res[0].length === 1) {
            return res[0][0];
          }
          // If it's a 1D column/row, return it as a flat list
          if (Array.isArray(res) && res.length === 1) return res[0];
          if (Array.isArray(res) && res.every(r => Array.isArray(r) && r.length === 1)) return res.map(r => r[0]);
          return res;
        }
        return target.has(row.value) ? target.get(row.value) : NONE;
      }

      if (typeof target === 'object' && target !== null) {
        return target[row.value] ?? NONE;
      }
      if (typeof target === 'string') {
        const idx = this._toArrayIndex(row.value, node, 'Index');
        return target[idx] ?? NONE;
      }
      throw new RuntimeError(`Indexing requires a list/dict/string target`, node.line);
    }

    if (!node.hasComma) {
      if (row.omitted) return target;
      if (row.isSlice) {
        const startRef = this._parseExcelCellRef(row.start);
        const endRef = this._parseExcelCellRef(row.end);
        if (startRef && endRef) {
          return this._sliceExcelRange(target, startRef, endRef);
        }
        return target.slice(row.start ?? undefined, row.end ?? undefined);
      }
      if (typeof row.value === 'string') {
        const cell = this._parseExcelCellRef(row.value);
        if (cell) {
          const tableRow = target[cell.row];
          return this._pickColumnFromRow(tableRow, cell.col);
        }
      }
      return target[row.value] ?? NONE;
    }

    // t[,] -> whole table
    if (row.omitted && col.omitted) return target;

    // Build selected row set first.
    let selectedRows;
    if (row.omitted) {
      selectedRows = target.slice();
    } else if (row.isSlice) {
      selectedRows = target.slice(row.start ?? undefined, row.end ?? undefined);
    } else {
      selectedRows = [target[row.value] ?? NONE];
    }

    // Row-only access in 2D form: t[r,] or t[r1:r2,]
    if (col.omitted) {
      if (!row.omitted && !row.isSlice) return selectedRows[0] ?? NONE;
      return selectedRows;
    }

    // Column slices: t[,c1:c2], t[r,c1:c2], t[r1:r2,c1:c2]
    if (col.isSlice) {
      const cStart = this._normalizeTableColumnSelector(col.start, node);
      const cEnd = this._normalizeTableColumnSelector(col.end, node);
      const projected = selectedRows.map(r => this._sliceColumnsFromRow(r, cStart, cEnd));
      if (!row.omitted && !row.isSlice) return projected[0] ?? NONE;
      return projected;
    }

    // Single column projection: t[,c], t[r,c], t[r1:r2,c]
    const colSelector = this._normalizeTableColumnSelector(col.value, node);
    const projected = selectedRows.map(r => this._pickColumnFromRow(r, colSelector));
    if (!row.omitted && !row.isSlice) return projected[0] ?? NONE;
    return projected;
  }

  async _evalLazyDeclExpr(node) {
    if (!this.globals.has(node.name)) {
      this.globals.set(node.name, NONE);
    }
    return this.globals.get(node.name);
  }

  async _evalPostExpr(node, env) {
    return await this._executePost(node, env);
  }

  async _evalGetExpr(node, env) {
    return await this.runtime._executeGet(node, env);
  }

  async _evalUnaryOpExpr(node, env) {
    const operand = await this.evalExpr(node.operand, env);
    if (node.op === 'not') return Number.isInteger(operand) ? ~operand : !isTruthy(operand);
    return operand;
  }

  // ── Binary operations ──────────────────────────────────────────────────────
  async evalBinOp(node, env) {
    // Lazy inference: if either side is a LazyDecl, infer default from the other side
    if (node.left?.type === 'LazyDecl' || node.right?.type === 'LazyDecl') {
      const lazyNode = node.left?.type === 'LazyDecl' ? node.left : node.right;
      const otherNode = node.left?.type === 'LazyDecl' ? node.right : node.left;
      if (!this.globals.has(lazyNode.name)) {
        const otherVal = await this.evalExpr(otherNode, env);
        const defaultVal =
          typeof otherVal === 'number' && Number.isInteger(otherVal) ? 0
            : typeof otherVal === 'number' ? 0.0
              : typeof otherVal === 'string' ? ''
                : typeof otherVal === 'boolean' ? false
                  : NONE;
        this.globals.set(lazyNode.name, defaultVal);
      }
    }

    // Short-circuit for logical operators
    // If both sides are integers, use bitwise ops instead of boolean
    if (node.op === 'and') {
      const l = await this.evalExpr(node.left, env);
      if (!isTruthy(l)) return Number.isInteger(l) ? 0 : false;
      const r = await this.evalExpr(node.right, env);
      return (Number.isInteger(l) && Number.isInteger(r)) ? (l & r) : isTruthy(r);
    }
    if (node.op === 'or') {
      const l = await this.evalExpr(node.left, env);
      const r = await this.evalExpr(node.right, env);
      return (Number.isInteger(l) && Number.isInteger(r)) ? (l | r) : (isTruthy(l) || isTruthy(r));
    }
    if (node.op === 'nand') {
      const l = await this.evalExpr(node.left, env);
      const r = await this.evalExpr(node.right, env);
      return (Number.isInteger(l) && Number.isInteger(r)) ? ~(l & r) : !(isTruthy(l) && isTruthy(r));
    }
    if (node.op === 'nor') {
      const l = await this.evalExpr(node.left, env);
      const r = await this.evalExpr(node.right, env);
      return (Number.isInteger(l) && Number.isInteger(r)) ? ~(l | r) : !(isTruthy(l) || isTruthy(r));
    }

    let left = await this.evalExpr(node.left, env);
    let right = await this.evalExpr(node.right, env);
    if (FOREIGN.isPy(left) || FOREIGN.isPy(right)) {
      const dl = FOREIGN.deep(left), dr = FOREIGN.deep(right);
      if (FOREIGN.isPy(dl) || FOREIGN.isPy(dr)) {
        try {
          const r = FOREIGN.pyBinOp(node.op, left, right);
          if (r !== undefined) return r;
        } catch (e) { throw new RuntimeError(FOREIGN.errText(e), node.line); }
      }
      left = dl; right = dr;
    }

    // Element-wise broadcasting: list op scalar, scalar op list, or list op list
    const ARITH = new Set(['+', '-', '*', '/', '//', '%', '^']);
    if (ARITH.has(node.op)) {
      const leftArr = Array.isArray(left);
      const rightArr = Array.isArray(right);
      if (leftArr || rightArr) {
        const applyOp = (a, b) => {
          switch (node.op) {
            case '+': return a + b;
            case '&': return String(a) + String(b);
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? NONE : a / b;
            case '//': return b === 0 ? NONE : Math.floor(a / b);
            case '%': return a % b;
            case '^': return Math.pow(a, b);
            default: return NONE;
          }
        };
        if (leftArr && rightArr) {
          const len = Math.min(left.length, right.length);
          return Array.from({ length: len }, (_, i) => {
            const a = left[i], b = right[i];
            // 2D: both elements are rows → recurse element-wise on the rows
            if (Array.isArray(a) && Array.isArray(b)) {
              const rowLen = Math.min(a.length, b.length);
              return Array.from({ length: rowLen }, (_, j) => applyOp(a[j], b[j]));
            }
            if (Array.isArray(a)) return a.map(v => applyOp(v, b));
            if (Array.isArray(b)) return b.map(v => applyOp(a, v));
            return applyOp(a, b);
          });
        }
        if (leftArr) return left.map(v => Array.isArray(v) ? v.map(c => applyOp(c, right)) : applyOp(v, right));
        if (rightArr) return right.map(v => Array.isArray(v) ? v.map(c => applyOp(left, c)) : applyOp(left, v));
      }
    }

    switch (node.op) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return (typeof left === 'string' ? left : ivxRepr(left)) + (typeof right === 'string' ? right : ivxRepr(right));
        }
        return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': if (right === 0) throw new RuntimeError("You can't divide by zero. Check the value on the right side of the / (or %).", node.line);
        return left / right;
      case '//': if (right === 0) throw new RuntimeError("You can't divide by zero. Check the value on the right side of the / (or %).", node.line);
        return Math.floor(left / right);
      case '%': return left % right;
      case '^': return Math.pow(left, right);
      case '=': return ivxEqual(left, right);
      case '!=': return !ivxEqual(left, right);
      case '<': return left < right;
      case '>': return left > right;
      case '<=': return left <= right;
      case '>=': return left >= right;
      case 'is': return ivxEqual(left, right);
      case 'in': return ivxIn(left, right, node);
      case 'not in': return !ivxIn(left, right, node);

      case 'mostly': {
        if (!Array.isArray(left)) throw new RuntimeError("'mostly' needs a list on its left side, like: if votes mostly yes", node.line);
        if (left.length === 0) return false;
        const want = isTruthy(right);
        let hits = 0;
        for (const item of left) if (isTruthy(item) === want) hits++;
        return hits * 2 > left.length;            // strictly more than half; a tie is not "mostly"
      }
      case 'same': return (Number.isInteger(left) && Number.isInteger(right)) ? ~(left ^ right) : isTruthy(left) === isTruthy(right);
      case 'xor': return (Number.isInteger(left) && Number.isInteger(right)) ? (left ^ right) : isTruthy(left) !== isTruthy(right);
      case 'nand': return (Number.isInteger(left) && Number.isInteger(right)) ? ~(left & right) : !(isTruthy(left) && isTruthy(right));
      case 'nor': return (Number.isInteger(left) && Number.isInteger(right)) ? ~(left | right) : !(isTruthy(left) || isTruthy(right));
      default: throw new RuntimeError(`Unknown operator '${node.op}'`, node.line);
    }
  }

  // ── Function calls ─────────────────────────────────────────────────────────
  async evalCall(node, env) {
    const callee = env.get(node.name);
    if (callee === undefined && OLD_BUILTIN_HINTS[node.name]) {
      throw new RuntimeError(`'${node.name}(...)' isn't a function in Mutter. Write: ${OLD_BUILTIN_HINTS[node.name]}`, node.line);
    }

    // Evaluate arguments
    const args = [];
    for (const arg of node.args) args.push(await this.evalExpr(arg, env));

    if (typeof callee === 'function') return this._applyCallee(callee, args, node);
    if (!(callee instanceof IVXFunction) && !(callee instanceof IVXClass)) {
      throw new RuntimeError(`'${node.name}' isn't a function or a class, so it can't be called with ( ).`, node.line);
    }

    if (callee instanceof IVXClass) {
      try {
        return await callee.instantiate(args, this, node);
      } catch (e) {
        this.globals.set('err', e.message ?? String(e));
        throw (e instanceof RuntimeError ? e : new RuntimeError(e?.message ?? String(e), (typeof node !== 'undefined' && node) ? node.line : 0));
      }
    }

    // Built-in: body is null, delegate to _callBuiltin
    if (callee.body === null) {
      try {
        const res = await this._callBuiltin(callee.name, args, node);
        return res ?? NONE;
      } catch (e) {
        this.globals.set('err', e.message ?? String(e));
        throw (e instanceof RuntimeError ? e : new RuntimeError(e?.message ?? String(e), (typeof node !== 'undefined' && node) ? node.line : 0));
      }
    }

    // User-defined function
    const fnEnv = callee.closure.child();
    for (let i = 0; i < callee.params.length; i++) {
      const { name: pn, value: pv } = await resolveParam(callee.params[i], args[i], fnEnv, this);
      fnEnv.define(pn, pv);
    }

    try {
      const result = await this.execBlock(callee.body, fnEnv);
      if (result instanceof ReturnSignal) return result.value;
      return NONE;
    } catch (e) {
      // Propagate runtime errors but set err variable
      this.globals.set('err', e.message ?? String(e));
      throw (e instanceof RuntimeError ? e : new RuntimeError(e?.message ?? String(e), (typeof node !== 'undefined' && node) ? node.line : 0));
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isTruthy(v) {
  if (v === NONE) return false;
  if (FOREIGN.isPy(v)) { try { return FOREIGN.pyBool(v); } catch (e) { return true; } }
  if (v === false) return false;
  return true;
}

function ivxEqual(a, b) {
  if (a === NONE && b === NONE) return true;
  if (FOREIGN.isPy(a) || FOREIGN.isPy(b)) {
    const da = FOREIGN.deep(a), db = FOREIGN.deep(b);
    if (FOREIGN.isPy(da) || FOREIGN.isPy(db)) { try { return FOREIGN.pyBool(FOREIGN.pyBinOp('is', a, b)); } catch (e) { return a === b; } }
    return ivxEqual(da, db);
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) { if (!ivxEqual(b.get(k), v)) return false; }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => ivxEqual(v, b[i]));
  }
  return a === b;
}

function ivxIn(left, right, node) {
  if (right === NONE || right === undefined) return false;
  try {
    if (Array.isArray(right)) return right.some(v => ivxEqual(v, left));
    if (right instanceof Map) return right.has(left);
    if (typeof right === 'string') return String(right).includes(String(left));
  } catch (e) {
    return false;
  }
  return false;
}


// Convert an IVX value to an iterable of [primary, secondary] pairs
function toIterable(value, node) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new RuntimeError(`'each <N>' requires a non-negative whole number, got ${value}`, node?.line);
    }
    return Array.from({ length: value }, (_, i) => [i, i]);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => [v, i]);
  }
  if (value instanceof Map) {
    return [...value.entries()].map(([k, v]) => [k, v]);
  }
  if (typeof value === 'string') {
    return [...value].map((c, i) => [c, i]);
  }
  throw new RuntimeError(`'each ... in' needs a list, some text or a dictionary, but this is a ${typeof value}.`, node?.line);
}

// Human-readable representation of an IVX value
function ivxRepr(value) {
  if (value === NONE) return 'none';
  if (value instanceof IVXElement) return '#' + value.name;
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value instanceof IVXFunction) return `<fun ${value.name}>`;
  if (value instanceof IVXClass) return `<class ${value.name}>`;
  if (value instanceof IVXSuperProxy) return '<super>';
  if (value instanceof Map) {
    const cls = value.get('__class__');
    if (cls) return `<${cls} instance>`;
    const entries = [...value.entries()].filter(([k]) => !String(k).startsWith('__'));
    if (entries.length === 0) return '{}';
    return '{' + entries.map(([k, v]) => `${ivxRepr(k)}: ${ivxRepr(v)}`).join(', ') + '}';
  }
  if (Array.isArray(value)) return '[' + value.map(ivxRepr).join(', ') + ']';
  if (FOREIGN.isPy(value) || FOREIGN.isJsForeign(value)) return FOREIGN.repr(value);
  return String(value);
}

// ── Public API ────────────────────────────────────────────────────────────────
function interpret(source, options = {}) {
  const interp = new Interpreter(options);
  return interp.run(source, options);
}

// Network, Google Sheets and Drive keywords are intentionally not implemented in this build.
for (const m of ['ask', '_executePost', '_executeGet', '_evalAskExpr', '_evalSheetsOpenExpr', '_saveDriveFile', '_googleAPI']) {
  IVXRuntime.prototype[m] = async function () {
    throw new RuntimeError('Network, Sheets and Drive features are not available in this build', 0);
  };
}

window.VertexEngine = { Interpreter, ivxRepr, KEYWORDS };
})();
