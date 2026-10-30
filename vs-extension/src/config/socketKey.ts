import type * as vscode from 'vscode';

export const SET_SOCKET_KEY = 'stack3.setSocketApiKey';
export const SOCKET_KEY_SECRET = 'stack3.socketApiKey';

/**
 * The user's own Socket.dev key for package checks. It lives in VS Code's secret storage (the OS keychain), never in a setting
 * and never in the package. SOCKET_API_KEY in the editor's environment is the fallback, which is how a key in .env reaches a
 * development host.
 */
export async function getSocketKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return (await context.secrets.get(SOCKET_KEY_SECRET)) ?? process.env.SOCKET_API_KEY;
}
