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
