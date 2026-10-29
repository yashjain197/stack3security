import type * as vscode from 'vscode';
import { registerCommands } from './commands/register';

export function activate(context: vscode.ExtensionContext): void {
  registerCommands(context);
}

export function deactivate(): void {}
