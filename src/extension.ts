import type * as vscode from "vscode";
import { registerWorkbench } from "./workbenchController";

export function activate(context: vscode.ExtensionContext): void {
  registerWorkbench(context);
}

export function deactivate(): void {
  // Disposables registered in the extension context own shutdown.
}
