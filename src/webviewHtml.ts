import * as vscode from "vscode";

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const historyGraphScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "history-graph.js")
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "workbench.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "workbench.css")
  );
  const codiconStyleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "codicon.css")
  );
  const scriptNonce = nonce();

  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${codiconStyleUri}" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Local Agents</title>
  </head>
  <body>
    <div id="app" class="app" aria-live="polite">
      <div class="loading-screen">
        <div class="loading-mark"><span class="codicon codicon-sparkle-filled" aria-hidden="true"></span></div>
        <p>Starting Local Agent Workbench…</p>
      </div>
    </div>
    <script nonce="${scriptNonce}" src="${historyGraphScriptUri}"></script>
    <script nonce="${scriptNonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
