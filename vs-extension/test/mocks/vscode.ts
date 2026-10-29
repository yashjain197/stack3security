// Minimal stand-in for the `vscode` module in unit tests.
type Inspect = { defaultValue?: unknown; globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown };
const inspections = new Map<string, Inspect>();

export function __setInspect(section: string, key: string, value: Inspect): void {
  inspections.set(`${section}.${key}`, value);
}
export function __resetInspect(): void {
  inspections.clear();
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      inspect: (key: string) => inspections.get(`${section}.${key}`),
      get: (key: string) => {
        const i = inspections.get(`${section}.${key}`);
        return i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue ?? i?.defaultValue;
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
  showInformationMessage: async (m: string) => void __calls.infos.push(m),
  withProgress: async <T>(_o: unknown, task: (p: { report: (v: unknown) => void }) => Promise<T>) => {
    __calls.progress++;
    return task({ report: () => undefined });
  },
};
