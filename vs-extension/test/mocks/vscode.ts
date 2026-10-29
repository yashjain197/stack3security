// Minimal stand-in for the `vscode` module in unit tests.
type Inspect = { defaultValue?: unknown; globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown };
const inspections = new Map<string, Inspect>();
export const __config = { updates: [] as { section: string; key: string; value: unknown; target: number }[], failUpdate: false };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export function __setInspect(section: string, key: string, value: Inspect): void {
  inspections.set(`${section}.${key}`, value);
}
export function __resetInspect(): void {
  inspections.clear();
  __config.updates = [];
  __config.failUpdate = false;
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      inspect: (key: string) => inspections.get(`${section}.${key}`),
      get: (key: string) => {
        const i = inspections.get(`${section}.${key}`);
        return i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue ?? i?.defaultValue;
      },
      update: async (key: string, value: unknown, target: number) => {
        if (__config.failUpdate) throw new Error('cannot write settings');
        __config.updates.push({ section, key, value, target });
        if (target === 1) inspections.set(`${section}.${key}`, { ...inspections.get(`${section}.${key}`), globalValue: value });
      },
    };
  },
};

// ---- window / commands (Task 12 wiring) ----
export const __calls = {
  registered: [] as string[],
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  errors: [] as string[],
  warnings: [] as string[],
  infos: [] as string[],
  progress: 0,
  nextInput: undefined as string | undefined,
  lastInputOptions: undefined as { validateInput?: (v: string) => string | undefined; ignoreFocusOut?: boolean } | undefined,
};
export function __reset(): void {
  __resetGuardIfDefined();
  __config.updates = [];
  __config.failUpdate = false;
  __panels.length = 0;
  __docs.opened = []; __docs.shown = 0; __docs.language = []; __docs.clipboard = ''; __docs.warningAnswer = undefined; __docs.infoAnswer = undefined; __docs.lastInfo = undefined; __docs.infoCalls = []; __docs.lastWarning = undefined; __docs.providers.clear();
  __calls.registered = [];
  __calls.handlers = new Map();
  __calls.errors = [];
  __calls.warnings = [];
  __calls.infos = [];
  __calls.progress = 0;
  __calls.nextInput = undefined;
  __calls.lastInputOptions = undefined;
}

export const ProgressLocation = { Notification: 15 } as const;

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    __calls.registered.push(id);
    __calls.handlers.set(id, handler);
    return { dispose: () => __calls.handlers.delete(id) };
  },
};

export const window = {
  showInputBox: async (options: typeof __calls.lastInputOptions) => {
    __calls.lastInputOptions = options;
    return __calls.nextInput;
  },
  showErrorMessage: async (m: string) => void __calls.errors.push(m),
  showWarningMessage: async (m: string) => void __calls.warnings.push(m),
  showInformationMessage: async (...args: unknown[]) => {
    if (typeof args[0] === 'string') __calls.infos.push(args[0]);
    __docs.lastInfo = args;
    __docs.infoCalls.push(args);
    return __docs.infoAnswer;
  },
  withProgress: async <T>(_o: unknown, task: (p: { report: (v: unknown) => void }) => Promise<T>) => {
    __calls.progress++;
    return task({ report: () => undefined });
  },
};

// ---- Uri, webview panel, documents, clipboard (Task 13) ----
export class Uri {
  constructor(public scheme: string, public path: string) {}
  get fsPath(): string { return this.path; }
  static file(p: string): Uri { return new Uri('file', p); }
  static from(c: { scheme: string; path: string }): Uri { return new Uri(c.scheme, c.path); }
  static joinPath(base: Uri, ...parts: string[]): Uri { return new Uri(base.scheme, [base.path.replace(/\/+$/, ''), ...parts].join('/')); }
  toString(): string { return `${this.scheme}:${this.path}`; }
}
export const ViewColumn = { Active: -1, Beside: -2 } as const;

export interface MockPanel {
  viewType: string;
  title: string;
  options: Record<string, unknown>;
  html: string;
  posted: unknown[];
  revealed: number;
  disposed: boolean;
  receive(raw: unknown): void;
  dispose(): void;
}
export const __panels: MockPanel[] = [];
export const __docs = { opened: [] as string[], shown: 0, language: [] as string[], clipboard: '' , warningAnswer: undefined as string | undefined, infoAnswer: undefined as string | undefined, lastInfo: undefined as unknown[] | undefined, infoCalls: [] as unknown[][], lastWarning: undefined as unknown[] | undefined, providers: new Map<string, { provideTextDocumentContent(uri: Uri): unknown }>() };

(window as Record<string, unknown>).createWebviewPanel = ((viewType: string, title: string, _col: unknown, options: Record<string, unknown>) => {
  let onMessage: (raw: unknown) => void = () => undefined;
  let onDispose: () => void = () => undefined;
  const panel: MockPanel = {
    viewType, title, options, html: '', posted: [], revealed: 0, disposed: false,
    receive: (raw) => onMessage(raw),
    dispose: () => { panel.disposed = true; onDispose(); },
  };
  __panels.push(panel);
  return {
    webview: {
      cspSource: 'vscode-webview://test',
      asWebviewUri: (u: Uri) => new Uri('vscode-webview', u.path),
      postMessage: async (m: unknown) => { panel.posted.push(m); return true; },
      onDidReceiveMessage: (cb: (raw: unknown) => void) => { onMessage = cb; return { dispose: () => undefined }; },
      set html(v: string) { panel.html = v; },
      get html() { return panel.html; },
    },
    reveal: () => { panel.revealed++; },
    onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => undefined }; },
    dispose: panel.dispose,
  };
});

(window as Record<string, unknown>).showWarningMessage = async (...args: unknown[]) => { __docs.lastWarning = args; if (typeof args[0] === 'string') __calls.warnings.push(args[0]); return __docs.warningAnswer; };
(window as Record<string, unknown>).showTextDocument = async () => { __docs.shown++; };

export const languages = { setTextDocumentLanguage: async (_d: unknown, id: string) => void __docs.language.push(id) };
export const env = { clipboard: { writeText: async (t: string) => { __docs.clipboard = t; } } };
(workspace as Record<string, unknown>).registerTextDocumentContentProvider = (scheme: string, provider: { provideTextDocumentContent(uri: Uri): unknown }) => {
  __docs.providers.set(scheme, provider);
  return { dispose: () => __docs.providers.delete(scheme) };
};
(workspace as Record<string, unknown>).openTextDocument = async (uri: Uri) => { __docs.opened.push(uri.toString()); return { uri }; };

// ---- diagnostics, status bar, file watchers, git extension (Task 15) ----
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;
export class Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}
export class Diagnostic {
  source?: string;
  code?: string | number;
  constructor(public range: Range, public message: string, public severity: number) {}
}
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export class ThemeColor {
  constructor(public id: string) {}
}
export class RelativePattern {
  constructor(public base: Uri, public pattern: string) {}
}
(Uri as unknown as { parse: (s: string) => Uri }).parse = (s: string) => {
  const i = s.indexOf(':');
  return new Uri(s.slice(0, i), s.slice(i + 1));
};

export const __guard = {
  collections: [] as { name: string; store: Map<string, Diagnostic[]>; disposed: boolean }[],
  statusItems: [] as { text: string; tooltip?: string; backgroundColor?: ThemeColor; visible: boolean; command?: string; disposed: boolean }[],
  watchers: [] as { pattern: RelativePattern; fire(kind: 'create' | 'change' | 'delete', fsPath: string): void; disposed: boolean }[],
  folders: undefined as { uri: Uri; name: string }[] | undefined,
  trusted: true,
  gitExtension: undefined as unknown,
};
export function __resetGuard(): void {
  __guard.collections = [];
  __guard.statusItems = [];
  __guard.watchers = [];
  __guard.folders = undefined;
  __guard.trusted = true;
  __guard.gitExtension = undefined;
}

(languages as Record<string, unknown>).createDiagnosticCollection = (name: string) => {
  const c = { name, store: new Map<string, Diagnostic[]>(), disposed: false };
  __guard.collections.push(c);
  return {
    set: (uri: Uri, d: Diagnostic[]) => void c.store.set(uri.toString(), d),
    delete: (uri: Uri) => void c.store.delete(uri.toString()),
    clear: () => c.store.clear(),
    dispose: () => { c.disposed = true; },
  };
};
(window as Record<string, unknown>).createStatusBarItem = () => {
  const item = { text: '', tooltip: undefined as string | undefined, backgroundColor: undefined as ThemeColor | undefined, visible: false, command: undefined as string | undefined, disposed: false };
  __guard.statusItems.push(item);
  return Object.assign(item, { show: () => { item.visible = true; }, hide: () => { item.visible = false; }, dispose: () => { item.disposed = true; } });
};
Object.defineProperty(workspace, 'workspaceFolders', { get: () => __guard.folders, configurable: true });
Object.defineProperty(workspace, 'isTrusted', { get: () => __guard.trusted, configurable: true });
(workspace as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => undefined });
(workspace as Record<string, unknown>).onDidGrantWorkspaceTrust = () => ({ dispose: () => undefined });
(workspace as Record<string, unknown>).createFileSystemWatcher = (pattern: RelativePattern) => {
  const handlers = { create: [] as ((u: Uri) => void)[], change: [] as ((u: Uri) => void)[], delete: [] as ((u: Uri) => void)[] };
  const w = { pattern, disposed: false, fire: (kind: 'create' | 'change' | 'delete', fsPath: string) => handlers[kind].forEach((h) => h(Uri.file(fsPath))) };
  __guard.watchers.push(w);
  const on = (k: keyof typeof handlers) => (cb: (u: Uri) => void) => { handlers[k].push(cb); return { dispose: () => undefined }; };
  return { onDidCreate: on('create'), onDidChange: on('change'), onDidDelete: on('delete'), dispose: () => { w.disposed = true; } };
};
export const extensions = { getExtension: (id: string) => (id === 'vscode.git' ? __guard.gitExtension : undefined) };

function __resetGuardIfDefined(): void {
  if (typeof __resetGuard === 'function') __resetGuard();
}
