/**
 * Tree library for the Syntax Tree Sandbox, built on @icebolt/compiler-core.
 *
 * Saved benches live in a SQLite database in the player's own Google Drive
 * (drive.file scope). This site never receives them. Points are not stored:
 * SYNTAX scores last for one visit by design.
 */
import { createSqlJsDriver, executeAction, IceboltSchemaMismatchError, type SqlJsDatabaseLike } from '@icebolt/compiler-core/runtime';
import {
  DATA_CUSTODY_STATEMENT,
  GoogleDriveSyncManager,
  IceboltSyncError,
  bindAutoSync,
  readStorageSettings,
  writeStorageSettings,
  type StorageSettings,
} from '@icebolt/compiler-core/sync';
import { GoogleDriveAuth, IceboltAuthError, linkAuthToSync, renderDriveConnectButton } from '@icebolt/compiler-core/auth';
import { renderActionButtons, renderForm, renderStorageSettings, type UiManifest, type UiTableManifest } from '@icebolt/compiler-core/ui';
import { openIceboltClient, schemaMeta, type TreesRow } from './db/icebolt-client';
import manifestJson from './db/ui-manifest.json';

// ------------------------------------------------------- contract with SYNTAX

export interface BenchPhrase {
  category: string;
  label: string;
  words: string;
  bracketing: string;
  wordCount: number;
  depth: number;
}

/** Exposed by SYNTAX/index.html. */
export interface SyntaxApi {
  snapshot(): string;
  /** Replace the bench with a saved snapshot (undoable, earns no points). */
  open(snapshot: string): void;
  sentence(): string;
  wordCount(): number;
  phrases(): BenchPhrase[];
  isComplete(): boolean;
  toast(message: string): void;
}

declare global {
  interface Window {
    SYNTAX_API?: SyntaxApi;
    initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<{ Database: new (data?: Uint8Array) => SqlJsDatabaseLike }>;
  }
}

const APP_ID = 'syntax-tree-sandbox';
const VENDOR = new URL('./vendor/', import.meta.url).href;
const manifest = manifestJson as UiManifest;
const treesUi: UiTableManifest = manifest.tables['trees']!;

type Client = ReturnType<typeof openIceboltClient>;

// ----------------------------------------------------------------- helpers

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}

let sqlPromise: ReturnType<NonNullable<Window['initSqlJs']>> | null = null;
function loadSql(): NonNullable<typeof sqlPromise> {
  sqlPromise ??= new Promise<void>((resolve, reject) => {
    if (window.initSqlJs) return resolve();
    const s = h('script', { src: `${VENDOR}sql-wasm.js`, async: true });
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the database engine.'));
    document.head.append(s);
  }).then(() => window.initSqlJs!({ locateFile: (f) => `${VENDOR}${f}` }));
  return sqlPromise;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Modal built on <dialog>. Resolves with the clicked choice, or null on Escape. */
function modal<T extends string>(title: string, body: Node[], buttons: Array<{ value: T; label: string; primary?: boolean }>, validate?: (v: T) => string | null): Promise<T | null> {
  return new Promise((resolve) => {
    const err = h('p', { className: 'lib-err', role: 'alert' } as Partial<HTMLParagraphElement>);
    const row = h('div', { className: 'lib-dialog-actions' });
    const dlg = h('dialog', { className: 'lib-dialog' }, h('h3', { textContent: title }), ...body, err, row);
    for (const b of buttons) {
      row.append(
        h('button', {
          type: 'button',
          className: b.primary ? 'btn primary' : 'btn',
          textContent: b.label,
          onclick: () => {
            const problem = validate?.(b.value) ?? null;
            if (problem) {
              err.textContent = problem;
              return;
            }
            dlg.close();
            resolve(b.value);
          },
        }),
      );
    }
    dlg.addEventListener('cancel', () => resolve(null));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector('input') ?? dlg.querySelector('button'))?.focus();
  });
}

function passwordField(label: string, autocomplete: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'password', className: 'lib-input' });
  input.setAttribute('autocomplete', autocomplete);
  input.setAttribute('aria-label', label);
  return { wrap: h('label', { className: 'lib-field' }, h('span', { textContent: label }), input), input };
}

/** First connection: let the player decide how their library is stored. */
async function chooseStorage(): Promise<{ settings: StorageSettings; passphrase: string | null } | null> {
  const p1 = passwordField('Passphrase', 'new-password');
  const p2 = passwordField('Repeat passphrase', 'new-password');
  const choice = await modal(
    'Where your trees live',
    [
      h('p', { textContent: 'Your library will be one file in your own Google Drive. This site never receives it. Choose how it is stored:' }),
      h('p', { className: 'lib-small', textContent: 'Encrypted: only your passphrase opens it, not even Google. If you lose the passphrase, the library is gone for good.' }),
      p1.wrap,
      p2.wrap,
      h('p', { className: 'lib-small', textContent: 'Plain file: you can download it and open it in any SQLite tool. Google can read it like any file in your Drive.' }),
    ],
    [
      { value: 'plain', label: 'Plain file' },
      { value: 'encrypted', label: 'Encrypt it', primary: true },
    ],
    (v) => {
      if (v !== 'encrypted') return null;
      if (p1.input.value.length < 8) return 'Use at least 8 characters.';
      if (p1.input.value !== p2.input.value) return 'The passphrases don’t match.';
      return null;
    },
  );
  if (choice === null) return null;
  return choice === 'encrypted'
    ? { settings: { encryption: 'passphrase', readableExport: 'none' }, passphrase: p1.input.value }
    : { settings: { encryption: 'none', readableExport: 'none' }, passphrase: null };
}

async function askPassphrase(message: string): Promise<string | null> {
  const p = passwordField('Passphrase', 'current-password');
  const ok = await modal('Unlock your tree library', [h('p', { textContent: message }), p.wrap], [
    { value: 'cancel', label: 'Cancel' },
    { value: 'unlock', label: 'Unlock', primary: true },
  ], (v) => (v === 'unlock' && !p.input.value ? 'Enter your passphrase.' : null));
  return ok === 'unlock' ? p.input.value : null;
}

// ------------------------------------------------------------------- library

class TreeLibrary {
  readonly #api: SyntaxApi;
  readonly #root: HTMLElement;
  readonly #count: HTMLElement | null;
  readonly #auth: GoogleDriveAuth | null;
  #sync: GoogleDriveSyncManager | null = null;
  #client: Client | null = null;
  #passphrase: string | null = null;
  #openTreeId: string | null = null;
  /** Bench snapshot as last saved or opened; the update button appears only when the bench differs. */
  #savedSnap: string | null = null;
  #status = h('p', { className: 'lib-status', role: 'status' } as Partial<HTMLParagraphElement>);
  #list = h('ul', { className: 'lib-list' });

  constructor(api: SyntaxApi, dock: HTMLElement) {
    this.#api = api;
    this.#root = dock.querySelector<HTMLElement>('[data-lib-mount]') ?? dock;
    this.#count = dock.querySelector<HTMLElement>('[data-lib-count]');
    const clientId = dock.dataset['googleClientId']?.trim() ?? '';
    this.#auth = clientId ? new GoogleDriveAuth({ clientId }) : null;
    this.#auth?.subscribe((e) => {
      // After a reconnect, drop the inline reconnect button; linkAuthToSync flushes pending saves.
      if (e.type === 'token' && this.#client) {
        this.#status.parentElement?.querySelector('.lib-reconnect')?.remove();
        this.#setStatus('Reconnected. Saving any pending changes…', 'busy');
      }
    });
    window.addEventListener('syntax:change', () => this.#refreshUpdateButton());
    window.addEventListener('beforeunload', (e) => {
      if (this.#sync?.hasPendingPush) e.preventDefault();
    });
    this.#renderDisconnected();
  }

  // ----- disconnected

  #renderDisconnected(message?: string): void {
    const intro = h('p', { className: 'dock-hint', textContent: 'Save benches to your own Google Drive and reopen them on any device.' });
    if (!this.#auth) {
      this.#root.replaceChildren(intro, h('p', { className: 'lib-small', textContent: 'Drive saving isn’t switched on for this copy of the site.' }));
      return;
    }
    const button = renderDriveConnectButton(this.#auth, {
      labels: { 'signed-out': 'Connect Google Drive', 'signed-in': 'Opening your library…' },
      onConnected: (token) => this.#connect(token),
    });
    const kids: Node[] = [intro, button, h('p', { className: 'lib-small', textContent: DATA_CUSTODY_STATEMENT })];
    if (message) kids.splice(1, 0, h('p', { className: 'lib-err', textContent: message }));
    this.#root.replaceChildren(...kids);
  }

  async #connect(token: string): Promise<void> {
    if (this.#client) return; // a reconnect: linkAuthToSync already flushed pending saves
    const auth = this.#auth!;
    try {
      const sync = new GoogleDriveSyncManager({ appId: APP_ID, fileBaseName: 'syntax-trees', exportFolderName: 'Syntax Tree Sandbox – readable data' });
      const SQL = await loadSql();

      let pulled = await sync.pull(token, null).catch(async (err: unknown) => {
        if (!(err instanceof IceboltSyncError && err.code === 'crypto')) throw err;
        let message = 'Your library is encrypted. Enter the passphrase you chose.';
        for (;;) {
          const pass = await askPassphrase(message);
          if (pass === null) return 'cancelled' as const;
          try {
            const r = await sync.pull(token, pass);
            this.#passphrase = pass;
            return r;
          } catch (e) {
            if (!(e instanceof IceboltSyncError && e.code === 'crypto')) throw e;
            message = 'That passphrase didn’t open it. Try again.';
          }
        }
      });
      if (pulled === 'cancelled') {
        auth.signOut();
        this.#renderDisconnected();
        return;
      }

      let firstRun: StorageSettings | null = null;
      if (pulled === null) {
        const choice = await chooseStorage();
        if (!choice) {
          auth.signOut();
          this.#renderDisconnected();
          return;
        }
        firstRun = choice.settings;
        this.#passphrase = choice.passphrase;
        pulled = null;
      }

      const client = openIceboltClient(createSqlJsDriver(new SQL.Database(pulled?.bytes)));
      linkAuthToSync(auth, sync);
      bindAutoSync(client, sync, { getAccessToken: auth.getAccessToken, getEncryptionKey: () => this.#passphrase, schemaMeta, appLabel: 'Syntax Tree Sandbox' });
      if (firstRun) writeStorageSettings(client, firstRun); // first write: creates the file in Drive

      sync.subscribe((e) => this.#onSync(e));
      this.#sync = sync;
      this.#client = client;
      client.onChange(() => this.#renderList());
      this.#renderConnected();
    } catch (err) {
      auth.signOut();
      const msg =
        err instanceof IceboltSchemaMismatchError
          ? 'Your saved library was made by a different version of this page.'
          : err instanceof Error
            ? err.message
            : String(err);
      this.#renderDisconnected(msg);
    }
  }

  // ----- connected

  #renderConnected(): void {
    const client = this.#client!;
    const form = renderForm(treesUi, {
      onSubmit: (values) => this.#saveNew(values),
      onError: (err) => this.#api.toast(err instanceof Error ? err.message : String(err)),
    })!;
    form.querySelector('button[type=submit]')!.textContent = 'Save bench';

    const update = h('button', { type: 'button', className: 'btn small', hidden: true, onclick: () => this.#saveOver() });
    update.dataset['libUpdate'] = '';

    const settings = h('details', { className: 'lib-settings' }, h('summary', { textContent: 'Storage settings' }));
    settings.append(
      renderStorageSettings({
        settings: readStorageSettings(client),
        onChange: (next) => this.#changeSettings(next),
      }),
    );

    const disconnect = h('button', {
      type: 'button',
      className: 'btn small',
      textContent: 'Disconnect',
      onclick: async () => {
        await this.#sync?.flush().catch(() => undefined);
        this.#sync?.dispose();
        this.#sync = null;
        this.#client = null;
        this.#passphrase = null;
        this.#openTreeId = null;
        this.#savedSnap = null;
        this.#auth?.signOut();
        this.#renderDisconnected();
      },
    });

    this.#root.replaceChildren(this.#status, form, update, this.#list, h('div', { className: 'lib-foot' }, settings, disconnect));
    this.#setStatus('Connected to your Google Drive.');
    this.#renderList();
  }

  async #changeSettings(next: StorageSettings): Promise<void> {
    if (next.encryption === 'passphrase' && !this.#passphrase) {
      const p1 = passwordField('Passphrase', 'new-password');
      const p2 = passwordField('Repeat passphrase', 'new-password');
      const ok = await modal(
        'Choose a passphrase',
        [h('p', { textContent: 'Only this passphrase will open your library. If you lose it, nobody can recover it.' }), p1.wrap, p2.wrap],
        [
          { value: 'cancel', label: 'Cancel' },
          { value: 'ok', label: 'Encrypt', primary: true },
        ],
        (v) => (v === 'cancel' ? null : p1.input.value.length < 8 ? 'Use at least 8 characters.' : p1.input.value !== p2.input.value ? 'The passphrases don’t match.' : null),
      );
      if (ok !== 'ok') throw new Error('Encryption not turned on.');
      this.#passphrase = p1.input.value;
    }
    writeStorageSettings(this.#client!, next);
  }

  #saveNew(values: Record<string, unknown>): void {
    const api = this.#api;
    if (api.wordCount() === 0) throw new Error('Put some words on the bench first.');
    const client = this.#client!;
    const tree = client.transaction(() => {
      const row = client.table('trees').insert({
        title: String(values['title']),
        notes: (values['notes'] as string | null | undefined) ?? null,
        sentence: api.sentence(),
        state: api.isComplete() ? 'complete' : 'in_progress',
        bench: JSON.parse(api.snapshot()),
        word_count: api.wordCount(),
      });
      this.#insertPhrases(row.id);
      return row;
    });
    this.#openTreeId = tree.id;
    this.#savedSnap = api.snapshot();
    api.toast(`Saved “${tree.title}”.`);
  }

  #saveOver(): void {
    const id = this.#openTreeId;
    const client = this.#client;
    if (!id || !client) return;
    const api = this.#api;
    if (api.wordCount() === 0) {
      api.toast('The bench is empty. Undo to get the tree back before saving.');
      return;
    }
    client.transaction(() => {
      client.table('trees').where({ id }).update({
        sentence: api.sentence(),
        state: api.isComplete() ? 'complete' : 'in_progress',
        bench: JSON.parse(api.snapshot()),
        word_count: api.wordCount(),
        updated_at: new Date(),
      });
      client.table('phrases').where({ tree_id: id }).delete();
      this.#insertPhrases(id);
    });
    this.#savedSnap = api.snapshot();
    this.#refreshUpdateButton();
    api.toast('Saved changes.');
  }

  #insertPhrases(treeId: string): void {
    const phrases = this.#client!.table('phrases');
    for (const p of this.#api.phrases()) {
      phrases.insert({ tree_id: treeId, category: p.category, label: p.label, words: p.words, bracketing: p.bracketing, word_count: p.wordCount, depth: p.depth });
    }
  }

  #open(tree: TreesRow): void {
    this.#api.open(JSON.stringify(tree.bench));
    this.#openTreeId = tree.id;
    this.#savedSnap = this.#api.snapshot();
    this.#api.toast(`Opened “${tree.title}”. Undo goes back to your previous bench.`);
    this.#renderList();
  }

  #renderList(): void {
    const client = this.#client;
    if (!client) return;
    const trees = client.table('trees').orderBy('starred', 'desc').orderBy('updated_at', 'desc').select();
    if (this.#count) this.#count.textContent = trees.length ? String(trees.length) : '';

    if (!trees.some((t) => t.id === this.#openTreeId)) this.#openTreeId = null;
    this.#refreshUpdateButton();

    if (!trees.length) {
      this.#list.replaceChildren(h('li', { className: 'lib-empty', textContent: 'No saved trees yet. Build something, give it a title, and save.' }));
      return;
    }
    this.#list.replaceChildren(
      ...trees.map((t) => {
        const phraseCount = client.table('phrases').where({ tree_id: t.id }).count();
        const actions = renderActionButtons(treesUi, t, {
          onAction: (action, row) => {
            executeAction(client, action, row, treesUi.primaryKey);
          },
          confirm: (msg) => window.confirm(msg),
        });
        const star = actions.querySelector<HTMLButtonElement>('[data-action="toggleRow"]');
        if (star) star.textContent = t.starred ? 'Unstar' : 'Star';
        actions.prepend(h('button', { type: 'button', className: 'btn small primary', textContent: 'Open', onclick: () => this.#open(t) }));
        const title = h('b', { className: 'lib-title', textContent: (t.starred ? '★ ' : '') + t.title });
        const meta = h('span', {
          className: 'lib-meta',
          textContent: `${t.state === 'complete' ? 'Complete' : 'In progress'} · ${t.word_count} words · ${phraseCount} phrases · ${when(t.updated_at)}`,
        });
        const li = h('li', { className: 'lib-item' + (t.id === this.#openTreeId ? ' open' : '') }, title, meta, h('span', { className: 'lib-sentence', textContent: t.sentence }));
        if (t.notes) li.append(h('span', { className: 'lib-notes', textContent: t.notes }));
        li.append(actions);
        return li;
      }),
    );
  }

  #refreshUpdateButton(): void {
    const update = this.#root.querySelector<HTMLButtonElement>('[data-lib-update]');
    const client = this.#client;
    if (!update || !client) return;
    const current = this.#openTreeId ? client.table('trees').where({ id: this.#openTreeId }).first() : undefined;
    const edited = !!current && this.#api.snapshot() !== this.#savedSnap;
    update.hidden = !edited;
    update.textContent = edited ? `Save changes to “${current!.title}”` : '';
  }

  #setStatus(text: string, kind: 'ok' | 'busy' | 'err' = 'ok'): void {
    this.#status.textContent = text;
    this.#status.dataset['kind'] = kind;
  }

  #onSync(e: Parameters<Parameters<GoogleDriveSyncManager['subscribe']>[0]>[0]): void {
    if (e.type === 'state') {
      if (e.state === 'scheduled') this.#setStatus('Changes waiting to save…', 'busy');
      else if (e.state === 'pushing') this.#setStatus('Saving to your Drive…', 'busy');
      else if (e.state === 'backoff') this.#setStatus('Google asked us to slow down; retrying…', 'busy');
    } else if (e.type === 'pushed') {
      this.#setStatus(`Saved to your Drive (${e.encrypted ? 'encrypted' : 'plain file'}) · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } else if (e.type === 'error') {
      const err = e.error;
      if (err instanceof IceboltAuthError || (err instanceof IceboltSyncError && err.code === 'auth')) {
        this.#setStatus('Your Google session expired. Reconnect to keep saving; nothing is lost.', 'err');
        this.#showReconnect();
      } else if (err instanceof IceboltSyncError && err.code === 'conflict') {
        this.#setStatus('Your library changed on another device. Reload this page to get the latest before saving here.', 'err');
      } else {
        this.#setStatus(`Couldn’t save to Drive: ${err instanceof Error ? err.message : String(err)}`, 'err');
      }
    }
  }

  #showReconnect(): void {
    if (!this.#auth || this.#root.querySelector('.lib-reconnect')) return;
    const button = renderDriveConnectButton(this.#auth);
    button.classList.add('lib-reconnect');
    this.#status.after(button);
  }
}

// ------------------------------------------------------------------- mount

function mount(): void {
  const dock = document.getElementById('libraryDock');
  const api = window.SYNTAX_API;
  if (!dock || !api) return;
  new TreeLibrary(api, dock);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
