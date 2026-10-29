/**
 * Save button + Storage dropdown for the Syntax Tree Sandbox, built on
 * @icebolt/compiler-core.
 *
 * Saved benches live in a SQLite file inside a "Syntax Tree Sandbox" folder in
 * the player's own Google Drive (drive.file scope). This site never receives
 * them. Points are not stored: SYNTAX scores last for one visit by design.
 */
import {
  IceboltMigrationError,
  IceboltSchemaMismatchError,
  IceboltSchemaTooNewError,
  createSqlJsDriver,
  executeAction,
  type SchemaOpenResult,
  type SqlJsDatabaseLike,
} from '@icebolt/compiler-core/runtime';
import {
  DATA_CUSTODY_STATEMENT,
  GoogleDriveSyncManager,
  IceboltSyncError,
  bindAutoSync,
  readStorageSettings,
  writeStorageSettings,
  type StorageSettings,
  type SyncEvent,
} from '@icebolt/compiler-core/sync';
import { GoogleDriveAuth, IceboltAuthError, linkAuthToSync, renderDriveConnectButton } from '@icebolt/compiler-core/auth';
import { renderActionButtons, renderStorageSettings, type UiManifest, type UiTableManifest } from '@icebolt/compiler-core/ui';
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
const APP_NAME = 'Syntax Tree Sandbox';
const VENDOR = new URL('./vendor/', import.meta.url).href;
const treesUi: UiTableManifest = (manifestJson as UiManifest).tables['trees']!;

type Client = ReturnType<typeof openIceboltClient>;

// ----------------------------------------------------------------- helpers

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
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
  return d.toDateString() === new Date().toDateString()
    ? `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Title from the sentence: "The old dog chased the cat" (trimmed to fit the column). */
function autoTitle(sentence: string): string {
  const s = sentence.trim().replace(/\s+/g, ' ');
  if (!s) return 'Untitled tree';
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t;
}

/** Modal built on <dialog>. Resolves with the clicked choice, or null on Escape. */
function modal<T extends string>(title: string, body: Node[], buttons: Array<{ value: T; label: string; primary?: boolean }>, validate?: (v: T) => string | null): Promise<T | null> {
  return new Promise((resolve) => {
    const err = h('p', { className: 'lib-err' });
    err.setAttribute('role', 'alert');
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

async function chooseStorage(): Promise<{ settings: StorageSettings; passphrase: string | null } | null> {
  const p1 = passwordField('Passphrase', 'new-password');
  const p2 = passwordField('Repeat passphrase', 'new-password');
  const choice = await modal(
    'Where your trees live',
    [
      h('p', { textContent: `Saved trees go in a “${APP_NAME}” folder in your own Google Drive. This site never receives them.` }),
      h('p', { className: 'lib-small', textContent: 'Encrypted: only your passphrase opens them, not even Google. Lose the passphrase and they are gone for good.' }),
      p1.wrap,
      p2.wrap,
      h('p', { className: 'lib-small', textContent: 'Plain file: you can open it yourself in any SQLite tool; Google can read it like any file in your Drive.' }),
      h('p', { className: 'lib-small', textContent: 'You can change this later under Storage.' }),
    ],
    [
      { value: 'plain', label: 'Plain file' },
      { value: 'encrypted', label: 'Encrypt it', primary: true },
    ],
    (v) => (v !== 'encrypted' ? null : p1.input.value.length < 8 ? 'Use at least 8 characters.' : p1.input.value !== p2.input.value ? 'The passphrases don’t match.' : null),
  );
  if (choice === null) return null;
  return choice === 'encrypted'
    ? { settings: { encryption: 'passphrase', readableExport: 'none' }, passphrase: p1.input.value }
    : { settings: { encryption: 'none', readableExport: 'none' }, passphrase: null };
}

async function askPassphrase(message: string): Promise<string | null> {
  const p = passwordField('Passphrase', 'current-password');
  const ok = await modal('Unlock your saved trees', [h('p', { textContent: message }), p.wrap], [
    { value: 'cancel', label: 'Cancel' },
    { value: 'unlock', label: 'Unlock', primary: true },
  ], (v) => (v === 'unlock' && !p.input.value ? 'Enter your passphrase.' : null));
  return ok === 'unlock' ? p.input.value : null;
}

// ------------------------------------------------------------------- library

class TreeLibrary {
  readonly #api: SyntaxApi;
  readonly #auth: GoogleDriveAuth;
  readonly #saveBtn: HTMLButtonElement;
  readonly #menu: HTMLDetailsElement;
  readonly #summary: HTMLElement;
  readonly #panel: HTMLDivElement;
  #sync: GoogleDriveSyncManager | null = null;
  #client: Client | null = null;
  #passphrase: string | null = null;
  #connecting: Promise<boolean> | null = null;
  /** The saved tree the bench came from (opened or last saved), and its snapshot at that moment. */
  #openTreeId: string | null = null;
  #savedSnap: string | null = null;
  #status = h('p', { className: 'lib-status' });

  constructor(api: SyntaxApi, bar: HTMLElement, clientId: string) {
    this.#api = api;
    this.#auth = new GoogleDriveAuth({ clientId });
    this.#status.setAttribute('role', 'status');

    this.#saveBtn = h('button', { type: 'button', className: 'btn libsave', textContent: 'Save', title: 'Save this bench to your Google Drive (Ctrl+S)' });
    this.#saveBtn.addEventListener('click', () => void this.save());
    this.#summary = h('summary', { className: 'btn', textContent: 'Storage' });
    this.#summary.setAttribute('aria-label', 'Storage: saved trees and settings');
    this.#panel = h('div', { className: 'libpop' });
    this.#menu = h('details', { className: 'libmenu' }, this.#summary, this.#panel);
    bar.append(this.#saveBtn, this.#menu);

    this.#menu.addEventListener('toggle', () => {
      if (this.#menu.open) this.#renderPanel(); // always show the current list
    });
    document.addEventListener('click', (e) => {
      // composedPath survives re-renders that detach the clicked element from the panel.
      const path = e.composedPath();
      if (this.#menu.open && !path.includes(this.#menu) && !path.some((n) => n instanceof HTMLDialogElement)) this.#menu.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save();
      }
      if (e.key === 'Escape' && this.#menu.open) this.#menu.open = false;
    });
    window.addEventListener('syntax:change', () => this.#onBenchChange());
    window.addEventListener('beforeunload', (e) => {
      if (this.#sync?.hasPendingPush) e.preventDefault();
    });
    this.#auth.subscribe((e) => {
      if (e.type === 'token' && this.#client) {
        this.#panel.querySelector('.lib-reconnect')?.remove();
        this.#summary.classList.remove('attn');
        this.#setStatus('Reconnected. Saving any pending changes…', 'busy');
      }
    });
    this.#renderPanel();
  }

  // ----- save

  /** Save the bench: update the tree it came from, or save it as a new one. Connects Drive first if needed. */
  async save(asNew = false): Promise<void> {
    const api = this.#api;
    if (api.wordCount() === 0) {
      api.toast('Nothing on the bench to save yet.');
      return;
    }
    if (!this.#client && !(await this.#connect())) return; // signIn() runs synchronously inside this click
    const client = this.#client!;
    const snapshot = api.snapshot();
    const current = !asNew && this.#openTreeId ? client.table('trees').where({ id: this.#openTreeId }).first() : undefined;

    if (current && snapshot === this.#savedSnap) {
      api.toast(`“${current.title}” is already saved.`);
      return;
    }
    const fields = {
      sentence: api.sentence(),
      state: api.isComplete() ? ('complete' as const) : ('in_progress' as const),
      bench: JSON.parse(snapshot) as TreesRow['bench'],
      word_count: api.wordCount(),
    };
    const id = client.transaction(() => {
      let treeId: string;
      if (current) {
        client.table('trees').where({ id: current.id }).update({ ...fields, title: autoTitle(fields.sentence), updated_at: new Date() });
        client.table('phrases').where({ tree_id: current.id }).delete();
        treeId = current.id;
      } else {
        treeId = client.table('trees').insert({ ...fields, title: autoTitle(fields.sentence) }).id;
      }
      for (const p of api.phrases()) {
        client.table('phrases').insert({ tree_id: treeId, category: p.category, label: p.label, words: p.words, bracketing: p.bracketing, word_count: p.wordCount, depth: p.depth });
      }
      return treeId;
    });
    this.#openTreeId = id;
    this.#savedSnap = snapshot;
    this.#refreshSaveButton();
    api.toast(current ? 'Saved changes.' : `Saved “${autoTitle(fields.sentence)}”.`);
  }

  #onBenchChange(): void {
    if (this.#api.wordCount() === 0) {
      // A cleared bench starts a new tree; the next Save won't overwrite the old one.
      this.#openTreeId = null;
      this.#savedSnap = null;
    }
    this.#refreshSaveButton();
    if (this.#menu.open) this.#renderPanel();
  }

  #refreshSaveButton(): void {
    const saved = this.#openTreeId !== null && this.#api.snapshot() === this.#savedSnap;
    this.#saveBtn.textContent = saved ? 'Saved' : 'Save';
    this.#saveBtn.classList.toggle('is-saved', saved);
  }

  // ----- connect

  /** Must be called from a click/keypress: the Google popup opens synchronously inside it. */
  #connect(): Promise<boolean> {
    if (this.#client) return Promise.resolve(true);
    this.#connecting ??= this.#auth
      .signIn()
      .then((token) => this.#openLibrary(token))
      .catch((err: unknown) => {
        if (!(err instanceof IceboltAuthError && err.authCode === 'cancelled')) this.#api.toast(err instanceof Error ? err.message : String(err));
        return false;
      })
      .finally(() => {
        this.#connecting = null;
      });
    return this.#connecting;
  }

  async #openLibrary(token: string): Promise<boolean> {
    this.#setStatus('Opening your saved trees…', 'busy');
    try {
      const sync = new GoogleDriveSyncManager({ appId: APP_ID, folderName: APP_NAME, fileBaseName: 'syntax-trees' });
      const SQL = await loadSql();

      let pulled = await sync.pull(token, null).catch(async (err: unknown) => {
        if (!(err instanceof IceboltSyncError && err.code === 'crypto')) throw err;
        let message = 'Your saved trees are encrypted. Enter the passphrase you chose.';
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
        this.#auth.signOut();
        this.#renderPanel();
        return false;
      }

      let firstRun: StorageSettings | null = null;
      if (pulled === null) {
        const choice = await chooseStorage();
        if (!choice) {
          this.#auth.signOut();
          this.#renderPanel();
          return false;
        }
        firstRun = choice.settings;
        this.#passphrase = choice.passphrase;
      }

      // Saves from an earlier version of this page are upgraded in place (one transaction;
      // nothing changes if a step fails). The pre-upgrade copy is kept in Drive under Backups.
      let upgraded: Extract<SchemaOpenResult, { status: 'migrated' }> | null = null;
      const client = openIceboltClient(createSqlJsDriver(new SQL.Database(pulled?.bytes)), { onMigrated: (r) => (upgraded = r) });
      linkAuthToSync(this.#auth, sync);
      bindAutoSync(client, sync, { getAccessToken: this.#auth.getAccessToken, getEncryptionKey: () => this.#passphrase, schemaMeta, appLabel: APP_NAME });
      if (firstRun) writeStorageSettings(client, firstRun);
      sync.subscribe((e) => this.#onSync(e));
      client.onChange(() => {
        if (this.#menu.open) this.#renderPanel();
      });
      this.#sync = sync;
      this.#client = client;
      this.#setStatus('Connected to your Google Drive.');
      const up = upgraded as Extract<SchemaOpenResult, { status: 'migrated' }> | null;
      if (up) {
        const encryption = readStorageSettings(client).encryption === 'passphrase' && this.#passphrase ? { mode: 'passphrase' as const, key: this.#passphrase } : { mode: 'none' as const };
        await sync.backup(token, { bytes: up.backup, encryption, label: `before update v${up.version} ${new Date().toISOString().slice(0, 10)}` });
        this.#api.toast('Your saved trees were updated for this version of the page. A copy of the old version is in Backups in your Drive.');
      }
      this.#renderPanel();
      return true;
    } catch (err) {
      this.#auth.signOut();
      const msg =
        err instanceof IceboltSchemaTooNewError
          ? 'Your saved trees were updated by a newer version of this page. Reload to get it; nothing was changed.'
          : err instanceof IceboltMigrationError
            ? 'Your saved trees could not be updated for this version of the page, so nothing was changed. Please report this.'
            : err instanceof IceboltSchemaMismatchError
              ? 'That file in your Drive was not made by this page.'
              : err instanceof Error
                ? err.message
                : String(err);
      this.#api.toast(`Couldn’t open your saved trees: ${msg}`);
      this.#setStatus(msg, 'err');
      this.#renderPanel();
      return false;
    }
  }

  #disconnect = async (): Promise<void> => {
    await this.#sync?.flush().catch(() => undefined);
    this.#sync?.dispose();
    this.#sync = null;
    this.#client = null;
    this.#passphrase = null;
    this.#openTreeId = null;
    this.#savedSnap = null;
    this.#auth.signOut();
    this.#setStatus('');
    this.#refreshSaveButton();
    this.#renderPanel();
  };

  // ----- open / delete

  #open(tree: TreesRow): void {
    this.#api.open(JSON.stringify(tree.bench));
    this.#openTreeId = tree.id;
    this.#savedSnap = this.#api.snapshot();
    this.#refreshSaveButton();
    this.#menu.open = false;
    this.#api.toast(`Opened “${tree.title}”. Undo goes back to your previous bench.`);
  }

  // ----- dropdown

  #renderPanel(): void {
    const client = this.#client;
    if (!client) {
      const connect = h('button', { type: 'button', className: 'btn primary', textContent: 'Connect Google Drive', onclick: () => void this.#connect() });
      this.#panel.replaceChildren(
        h('p', { className: 'lib-lead', textContent: 'Save benches to your own Google Drive and reopen them on any device. Save connects automatically.' }),
        connect,
        this.#status,
        h('p', { className: 'lib-small', textContent: DATA_CUSTODY_STATEMENT }),
      );
      return;
    }

    const trees = client.table('trees').orderBy('updated_at', 'desc').select();
    const list = h('ul', { className: 'lib-list' });
    if (!trees.length) list.append(h('li', { className: 'lib-empty', textContent: 'Nothing saved yet. Build something and press Save.' }));
    for (const t of trees) {
      const open = h(
        'button',
        { type: 'button', className: 'lib-open', title: 'Open on the bench', onclick: () => this.#open(t) },
        h('b', { textContent: t.title }),
        h('span', { textContent: `${t.state === 'complete' ? 'Complete' : 'In progress'} · ${t.word_count} words · ${when(t.updated_at)}` }),
      );
      const del = renderActionButtons(treesUi, t, {
        onAction: (action, row) => {
          if (t.id === this.#openTreeId) {
            this.#openTreeId = null;
            this.#savedSnap = null;
            this.#refreshSaveButton();
          }
          executeAction(client, action, row, treesUi.primaryKey);
        },
      });
      del.querySelector('button')?.setAttribute('aria-label', `Delete “${t.title}”`);
      list.append(h('li', { className: t.id === this.#openTreeId ? 'lib-item open' : 'lib-item' }, open, del));
    }

    const kids: Node[] = [this.#status, h('h3', { textContent: 'Saved trees' }), list];
    if (this.#openTreeId) {
      kids.push(h('button', { type: 'button', className: 'btn small lib-copy', textContent: 'Save as a new tree', onclick: () => void this.save(true) }));
    }
    kids.push(
      h(
        'details',
        { className: 'lib-settings' },
        h('summary', { textContent: 'Storage settings' }),
        renderStorageSettings({ settings: readStorageSettings(client), onChange: (next) => this.#changeSettings(next) }),
      ),
      h('button', { type: 'button', className: 'btn small', textContent: 'Disconnect Google Drive', onclick: () => void this.#disconnect() }),
    );
    const settingsOpen = this.#panel.querySelector<HTMLDetailsElement>('.lib-settings')?.open ?? false;
    this.#panel.replaceChildren(...kids);
    if (settingsOpen) this.#panel.querySelector<HTMLDetailsElement>('.lib-settings')!.open = true;
  }

  async #changeSettings(next: StorageSettings): Promise<void> {
    if (next.encryption === 'passphrase' && !this.#passphrase) {
      const p1 = passwordField('Passphrase', 'new-password');
      const p2 = passwordField('Repeat passphrase', 'new-password');
      const ok = await modal(
        'Choose a passphrase',
        [h('p', { textContent: 'Only this passphrase will open your saved trees. If you lose it, nobody can recover them.' }), p1.wrap, p2.wrap],
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

  #setStatus(text: string, kind: 'ok' | 'busy' | 'err' = 'ok'): void {
    this.#status.textContent = text;
    this.#status.dataset['kind'] = kind;
    this.#status.hidden = !text;
  }

  #onSync(e: SyncEvent): void {
    if (e.type === 'state') {
      if (e.state === 'scheduled') this.#setStatus('Saving…', 'busy');
      else if (e.state === 'pushing') this.#setStatus('Saving to your Drive…', 'busy');
      else if (e.state === 'backoff') this.#setStatus('Google asked us to slow down; retrying…', 'busy');
    } else if (e.type === 'pushed') {
      this.#summary.classList.remove('attn');
      this.#setStatus(`Saved to “${APP_NAME}” in your Drive (${e.encrypted ? 'encrypted' : 'plain file'}) · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    } else if (e.type === 'error') {
      const err = e.error;
      this.#summary.classList.add('attn');
      if (err instanceof IceboltAuthError || (err instanceof IceboltSyncError && err.code === 'auth')) {
        this.#setStatus('Your Google session expired. Reconnect to keep saving; nothing is lost.', 'err');
        if (!this.#panel.querySelector('.lib-reconnect')) {
          const b = renderDriveConnectButton(this.#auth);
          b.classList.add('lib-reconnect');
          this.#status.after(b);
        }
        this.#api.toast('Google session expired. Open Storage to reconnect.');
      } else if (err instanceof IceboltSyncError && err.code === 'conflict') {
        this.#setStatus('Your saved trees changed on another device. Reload this page to get the latest before saving here.', 'err');
      } else {
        this.#setStatus(`Couldn’t save to Drive: ${err instanceof Error ? err.message : String(err)}`, 'err');
      }
    }
  }
}

// ------------------------------------------------------------------- mount

function mount(): void {
  const bar = document.getElementById('libraryBar');
  const api = window.SYNTAX_API;
  const clientId = bar?.dataset['googleClientId']?.trim() ?? '';
  if (!bar || !api || !clientId) return; // not switched on: no buttons, no Google script, no database engine
  new TreeLibrary(api, bar, clientId);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
