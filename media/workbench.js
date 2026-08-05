(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const saved = vscode.getState() || {};
  const state = {
    snapshot: null,
    query: saved.query || "",
    filter: saved.filter || "active",
    leftHidden: Boolean(saved.leftHidden),
    rightHidden: Boolean(saved.rightHidden),
    leftWidth: clamp(Number(saved.leftWidth) || 284, 220, 520),
    rightWidth: clamp(Number(saved.rightWidth) || 310, 240, 560),
    drafts: saved.drafts || {},
    modal: null,
    nativeSessions: [],
    importLoading: false,
    workspacePicked: "",
    toastTimer: null
  };

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function persist() {
    vscode.setState({
      query: state.query,
      filter: state.filter,
      leftHidden: state.leftHidden,
      rightHidden: state.rightHidden,
      leftWidth: state.leftWidth,
      rightWidth: state.rightWidth,
      drafts: state.drafts
    });
  }

  function post(type, detail) {
    vscode.postMessage(Object.assign({ type }, detail || {}));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function attr(value) {
    return escapeHtml(value);
  }

  function icon(name, label) {
    const paths = {
      agents: '<path d="M12 2.6l1.7 4.1 4.1 1.7-4.1 1.7L12 14.2l-1.7-4.1-4.1-1.7 4.1-1.7L12 2.6zm-6.7 10l1.1 2.7 2.7 1.1-2.7 1.1-1.1 2.7-1.1-2.7-2.7-1.1 2.7-1.1 1.1-2.7zm12.8 2l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8.8-1.8z"/>',
      add: '<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z"/>',
      search: '<path d="M10.5 4a6.5 6.5 0 104.02 11.61L19.91 21 21 19.91l-5.39-5.39A6.5 6.5 0 0010.5 4zm0 1.5a5 5 0 110 10 5 5 0 010-10z"/>',
      settings: '<path d="M10.9 2h2.2l.5 2.2c.5.2 1 .4 1.4.8l2.1-.7 1.1 1.9-1.7 1.5c.1.3.2.9.2 1.3s-.1 1-.2 1.3l1.7 1.5-1.1 1.9-2.1-.7c-.4.4-.9.6-1.4.8l-.5 2.2h-2.2l-.5-2.2c-.5-.2-1-.4-1.4-.8l-2.1.7-1.1-1.9 1.7-1.5c-.1-.3-.2-.9-.2-1.3s.1-1 .2-1.3L5.8 6.2l1.1-1.9L9 5c.4-.4.9-.6 1.4-.8l.5-2.2zM12 7a3 3 0 100 6 3 3 0 000-6z" transform="translate(0 3)"/>',
      layoutLeft: '<path d="M3 4h18v16H3V4zm1.5 1.5v13h4v-13h-4zm5.5 0v13h9.5v-13H10z"/>',
      layoutRight: '<path d="M3 4h18v16H3V4zm1.5 1.5v13H14v-13H4.5zm11 0v13h4v-13h-4z"/>',
      detach: '<path d="M13 3h8v8h-2V6.4l-7.3 7.3-1.4-1.4L17.6 5H13V3zM5 6h5v2H7v9h9v-3h2v5H5V6z"/>',
      import: '<path d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3zM4 19h16v2H4v-2z"/>',
      output: '<path d="M4 5h16v14H4V5zm2 2v10h12V7H6zm1.5 2L9 10.5 7.5 12 9 13.5 12 10.5 9 7.5 7.5 9zm5.5 5h4v1.5h-4V14z"/>',
      send: '<path d="M3 3l19 9-19 9 3-8 9-1-9-1-3-8z"/>',
      stop: '<path d="M6 6h12v12H6z"/>',
      refresh: '<path d="M19 7V3l-1.8 1.8A8 8 0 104 17l1.5-1.3A6 6 0 1117.4 8H13V6h6v1z"/>',
      folder: '<path d="M3 5h7l2 2h9v12H3V5zm2 2v10h14V9h-7.8l-2-2H5z"/>',
      branch: '<path d="M6 3a3 3 0 012.8 4H15a3 3 0 110 2H8.8A3 3 0 017 10.8v2.4A3 3 0 119 16a3 3 0 01-2 2.8A3 3 0 015 16a3 3 0 012-2.8v-2.4A3 3 0 016 5a1 1 0 100 2 1 1 0 000-2z"/>',
      close: '<path d="M6.3 4.9L12 10.6l5.7-5.7 1.4 1.4-5.7 5.7 5.7 5.7-1.4 1.4-5.7-5.7-5.7 5.7-1.4-1.4 5.7-5.7-5.7-5.7 1.4-1.4z"/>',
      chevron: '<path d="M8.6 5.6L15 12l-6.4 6.4-1.4-1.4 5-5-5-5 1.4-1.4z"/>',
      file: '<path d="M6 2h8l5 5v15H6V2zm2 2v16h9V8h-4V4H8zm7 .8V6h1.2L15 4.8z"/>',
      more: '<path d="M5 10a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z"/>',
      edit: '<path d="M17.7 3.3a2.4 2.4 0 013.4 3.4L9 18.8 4 20l1.2-5L17.7 3.3zm-11 12.5l-.5 2 2-.5 9.9-9.9-1.5-1.5-9.9 9.9z"/>',
      copy: '<path d="M8 3h11v14h-3v4H5V7h3V3zm2 4h6v8h1V5h-7v2zm-3 2v10h7V9H7z"/>',
      archive: '<path d="M4 3h16l2 4v2h-1v11H3V9H2V7l2-4zm1.3 2l-1 2h15.4l-1-2H5.3zM5 9v9h14V9H5zm4 2h6v2H9v-2z"/>',
      trash: '<path d="M8 3h8l1 2h4v2H3V5h4l1-2zm-2 6h12l-1 12H7L6 9zm3 2v8h2v-8H9zm4 0v8h2v-8h-2z"/>',
      browse: '<path d="M3 5h7l2 2h9v12H3V5zm2 2v10h14V9h-7.8l-2-2H5z"/>'
    };
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.file) + '</svg><span class="sr-only">' + escapeHtml(label || name) + '</span>';
  }

  function timeAgo(timestamp) {
    const time = new Date(timestamp).getTime();
    const elapsed = Date.now() - time;
    if (!Number.isFinite(elapsed)) return "";
    if (elapsed < 60_000) return "now";
    if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + "m";
    if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + "h";
    if (elapsed < 604_800_000) return Math.floor(elapsed / 86_400_000) + "d";
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function shortPath(value) {
    if (!value) return "";
    const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length > 3 ? "…/" + parts.slice(-3).join("/") : value;
  }

  function providerName(provider) {
    return provider === "codex" ? "Codex" : "Claude";
  }

  function providerLogo(provider) {
    return '<span class="provider-logo ' + provider + '" aria-hidden="true">' + (provider === "codex" ? "◎" : "A") + "</span>";
  }

  function permissionName(permission) {
    return ({
      plan: "Plan",
      "read-only": "Read only",
      "workspace-write": "Workspace",
      "full-access": "Full access"
    })[permission] || permission;
  }

  function activeSession() {
    if (!state.snapshot) return null;
    return state.snapshot.sessions.find((session) => session.id === state.snapshot.activeSessionId) || null;
  }

  function updateSessionLocal(session) {
    if (!state.snapshot) return;
    const index = state.snapshot.sessions.findIndex((item) => item.id === session.id);
    if (index === -1) state.snapshot.sessions.unshift(session);
    else state.snapshot.sessions[index] = session;
  }

  function formatMessage(value) {
    const source = String(value || "");
    const chunks = source.split(/(```[\s\S]*?```)/g);
    return chunks.map((chunk) => {
      if (chunk.startsWith("```") && chunk.endsWith("```")) {
        const body = chunk.slice(3, -3);
        const firstBreak = body.indexOf("\n");
        const code = firstBreak >= 0 ? body.slice(firstBreak + 1) : body;
        const language = firstBreak >= 0 ? body.slice(0, firstBreak).trim() : "";
        return '<div class="code-block"><div class="code-caption">' + escapeHtml(language || "code") + '</div><pre><code>' + escapeHtml(code) + "</code></pre></div>";
      }
      let safe = escapeHtml(chunk);
      safe = safe.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      safe = safe.replace(/^### (.+)$/gm, "<h4>$1</h4>");
      safe = safe.replace(/^## (.+)$/gm, "<h3>$1</h3>");
      safe = safe.replace(/^# (.+)$/gm, "<h2>$1</h2>");
      safe = safe.replace(/^[-*] (.+)$/gm, "<span class=\"list-line\">• $1</span>");
      safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      return '<div class="prose-lines">' + safe.replace(/\n/g, "<br>") + "</div>";
    }).join("");
  }

  function sessionList() {
    const snapshot = state.snapshot;
    if (!snapshot) return "";
    const needle = state.query.trim().toLowerCase();
    const sessions = snapshot.sessions.filter((session) => {
      if (state.filter === "active" && session.status === "archived") return false;
      if (state.filter === "archived" && session.status !== "archived") return false;
      if (state.filter === "claude" && session.provider !== "claude") return false;
      if (state.filter === "codex" && session.provider !== "codex") return false;
      if (!needle) return true;
      return (session.title + " " + session.workspace + " " + session.provider).toLowerCase().includes(needle);
    });
    if (!sessions.length) {
      return '<div class="sidebar-empty">No matching sessions</div>';
    }
    const groups = new Map();
    sessions.forEach((session) => {
      const key = session.workspace;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(session);
    });
    return Array.from(groups.entries()).map(([workspace, items]) => {
      const workspaceName = workspace.replace(/\\/g, "/").split("/").filter(Boolean).pop() || workspace;
      return '<section class="session-group"><div class="group-label" title="' + attr(workspace) + '">' + icon("chevron") + '<span>' + escapeHtml(workspaceName) + '</span><span class="group-count">' + items.length + '</span></div>' + items.map((session) => sessionRow(session)).join("") + "</section>";
    }).join("");
  }

  function sessionRow(session) {
    const active = session.id === state.snapshot.activeSessionId;
    const status = session.status === "running" ? '<span class="run-spinner" title="Running"></span>' : session.status === "error" ? '<span class="status-dot error" title="Error"></span>' : "";
    return '<div class="session-row ' + (active ? "active" : "") + '" data-session-id="' + attr(session.id) + '"><button class="session-select" data-action="selectSession" data-session-id="' + attr(session.id) + '">' + providerLogo(session.provider) + '<span class="session-copy"><span class="session-title">' + escapeHtml(session.title) + '</span><span class="session-subtitle">' + escapeHtml(providerName(session.provider)) + (session.model ? " · " + escapeHtml(session.model) : "") + '</span></span><span class="session-tail">' + status + '<span class="session-time">' + timeAgo(session.updatedAt) + '</span></span></button><button class="icon-button row-menu" data-action="sessionMenu" data-session-id="' + attr(session.id) + '" title="Session actions">' + icon("more") + '</button></div>';
  }

  function healthChip(provider) {
    const health = state.snapshot.health[provider];
    return '<button class="health-chip ' + (health.available ? "ok" : "missing") + '" data-action="checkHealth" title="' + attr(health.available ? health.version || health.executable : health.error || "CLI unavailable") + '"><span class="health-dot"></span>' + escapeHtml(providerName(provider)) + "</button>";
  }

  function topbar() {
    return '<header class="topbar"><div class="brand">' + icon("agents") + '<span>Local Agents</span><span class="brand-badge">LOCAL</span></div><div class="provider-health">' + healthChip("claude") + healthChip("codex") + '</div><div class="topbar-spacer"></div><button class="icon-button ' + (state.leftHidden ? "muted" : "") + '" data-action="toggleLeft" title="Toggle sessions pane">' + icon("layoutLeft") + '</button><button class="icon-button ' + (state.rightHidden ? "muted" : "") + '" data-action="toggleRight" title="Toggle changes pane">' + icon("layoutRight") + '</button><span class="topbar-separator"></span><button class="icon-button" data-action="import" title="Import Claude or Codex session">' + icon("import") + '</button><button class="icon-button" data-action="output" title="Show agent output">' + icon("output") + '</button><button class="icon-button" data-action="settings" title="Open settings">' + icon("settings") + '</button><button class="icon-button" data-action="detach" title="Move to a new VS Code window">' + icon("detach") + '</button><button class="primary-button top-new" data-action="openNew">' + icon("add") + '<span>New session</span></button></header>';
  }

  function sidebar() {
    return '<aside class="sidebar"><div class="sidebar-heading"><span>Sessions</span><button class="icon-button small" data-action="openNew" title="New session">' + icon("add") + '</button></div><label class="search-box">' + icon("search") + '<input id="session-search" type="search" placeholder="Search sessions" value="' + attr(state.query) + '" aria-label="Search sessions"></label><div class="filter-row">' + [
      ["active", "Active"], ["all", "All"], ["claude", "Claude"], ["codex", "Codex"], ["archived", "Archived"]
    ].map(([value, label]) => '<button class="filter-button ' + (state.filter === value ? "active" : "") + '" data-action="filter" data-filter="' + value + '">' + label + "</button>").join("") + '</div><div class="session-scroll">' + sessionList() + '</div><button class="sidebar-import" data-action="import">' + icon("import") + '<span>Import local history</span></button></aside>';
  }

  function emptyCenter() {
    const claude = state.snapshot.health.claude;
    const codex = state.snapshot.health.codex;
    return '<main class="conversation empty"><div class="welcome"><div class="welcome-mark">' + icon("agents") + '</div><h1>Work with your local agents</h1><p>Run Claude Code and Codex directly from your machine, using your existing user configuration and credentials.</p><div class="provider-cards"><button class="provider-card" data-action="quickNew" data-provider="claude">' + providerLogo("claude") + '<span><strong>Claude Code</strong><small>' + escapeHtml(claude.available ? claude.version || "Ready" : "CLI not found") + '</small></span><span class="card-arrow">→</span></button><button class="provider-card" data-action="quickNew" data-provider="codex">' + providerLogo("codex") + '<span><strong>OpenAI Codex</strong><small>' + escapeHtml(codex.available ? codex.version || "Ready" : "CLI not found") + '</small></span><span class="card-arrow">→</span></button></div><div class="welcome-actions"><button class="primary-button" data-action="openNew">' + icon("add") + 'New session</button><button class="secondary-button" data-action="import">' + icon("import") + 'Import history</button></div><p class="privacy-note">Prompts are sent only to the CLI provider you launch. Copilot sign-in is not used.</p></div></main>';
  }

  function messageCard(message, session) {
    const roleName = ({ user: "You", assistant: providerName(session.provider), reasoning: "Reasoning", tool: message.title || "Tool", system: "System", error: message.title || "Error" })[message.role] || message.role;
    const collapsible = message.role === "tool" || message.role === "reasoning";
    const body = '<div class="message-body" data-message-id="' + attr(message.id) + '">' + formatMessage(message.content) + (message.state === "running" && message.role === "assistant" ? '<span class="stream-cursor"></span>' : "") + "</div>";
    if (collapsible) {
      return '<details class="message-card compact-card ' + message.role + '" ' + (message.state === "running" ? "open" : "") + ' data-message="' + attr(message.id) + '"><summary><span class="tool-state ' + attr(message.state || "completed") + '"></span><span>' + escapeHtml(roleName) + '</span><span class="summary-spacer"></span><span class="message-time">' + timeAgo(message.createdAt) + "</span></summary>" + body + "</details>";
    }
    return '<article class="message-card ' + message.role + '" data-message="' + attr(message.id) + '"><header><span class="message-author">' + (message.role === "assistant" ? providerLogo(session.provider) : '<span class="role-icon ' + message.role + '">' + (message.role === "user" ? "Y" : "!") + "</span>") + '<strong>' + escapeHtml(roleName) + '</strong></span><span class="message-time">' + timeAgo(message.createdAt) + "</span></header>" + body + "</article>";
  }

  function composer(session) {
    const draft = state.drafts[session.id] || "";
    const running = session.status === "running";
    return '<div class="composer-wrap"><div class="composer ' + (running ? "running" : "") + '"><textarea id="prompt-input" rows="1" placeholder="Ask ' + escapeHtml(providerName(session.provider)) + ' to work on this repository…" ' + (running ? "disabled" : "") + '>' + escapeHtml(draft) + '</textarea><div class="composer-footer"><div class="composer-context"><span>' + icon("branch") + escapeHtml(shortPath(session.workspace)) + '</span><span class="permission-pill ' + attr(session.permission) + '">' + escapeHtml(permissionName(session.permission)) + "</span></div>" + (running ? '<button class="stop-button" data-action="cancelRun">' + icon("stop") + "Stop</button>" : '<button class="send-button" data-action="send" title="Send (Cmd/Ctrl+Enter)">' + icon("send") + "</button>") + '</div></div><div class="composer-hint">Local agents may make mistakes. Review workspace changes before committing.</div></div>';
  }

  function conversation() {
    const session = activeSession();
    if (!session) return emptyCenter();
    const modelPlaceholder = session.provider === "claude" ? "Configured Claude model" : "Configured Codex model";
    const messages = session.messages.length ? session.messages.map((message) => messageCard(message, session)).join("") : '<div class="conversation-starter"><div class="starter-logo">' + providerLogo(session.provider) + '</div><h2>Start a ' + escapeHtml(providerName(session.provider)) + ' session</h2><p>' + escapeHtml(shortPath(session.workspace)) + '</p><div class="starter-prompts"><button data-action="starter" data-prompt="Inspect this repository and explain its architecture.">Explain this repository</button><button data-action="starter" data-prompt="Review the current workspace changes and identify issues.">Review current changes</button><button data-action="starter" data-prompt="Run the relevant tests and diagnose any failures.">Run and diagnose tests</button></div></div>';
    return '<main class="conversation"><header class="conversation-header"><div class="title-stack"><input class="session-title-input" id="session-title" value="' + attr(session.title) + '" aria-label="Session title"><div class="workspace-path" title="' + attr(session.workspace) + '">' + icon("folder") + escapeHtml(shortPath(session.workspace)) + (session.nativeSessionId ? '<span class="native-badge">resumable</span>' : "") + '</div></div><div class="session-controls"><label class="control-field model-field"><span>Model</span><input id="session-model" value="' + attr(session.model || "") + '" placeholder="' + attr(modelPlaceholder) + '" ' + (session.status === "running" ? "disabled" : "") + '></label><label class="control-field"><span>Access</span><select id="session-permission" ' + (session.status === "running" ? "disabled" : "") + '><option value="plan" ' + selected(session.permission, "plan") + '>Plan</option><option value="read-only" ' + selected(session.permission, "read-only") + '>Read only</option><option value="workspace-write" ' + selected(session.permission, "workspace-write") + '>Workspace</option><option value="full-access" ' + selected(session.permission, "full-access") + '>Full access</option></select></label><button class="icon-button" data-action="sessionMenu" data-session-id="' + attr(session.id) + '" title="Session actions">' + icon("more") + '</button></div></header><div id="message-list" class="message-list">' + messages + '</div>' + composer(session) + '</main>';
  }

  function selected(current, value) {
    return current === value ? "selected" : "";
  }

  function changesPane() {
    const session = activeSession();
    const changes = state.snapshot.changes || [];
    const changeRows = changes.length ? changes.map((change) => '<div class="change-row"><button data-action="openDiff" data-path="' + attr(change.path) + '" title="Open diff for ' + attr(change.path) + '"><span class="change-status ' + (change.untracked ? "untracked" : change.staged ? "staged" : "") + '">' + escapeHtml(change.status) + '</span><span class="change-path">' + escapeHtml(change.path) + '</span></button><button class="icon-button small" data-action="openFile" data-path="' + attr(change.path) + '" title="Open file">' + icon("file") + "</button></div>").join("") : '<div class="changes-empty"><span class="empty-check">✓</span><strong>Workspace clean</strong><span>No uncommitted files detected</span></div>';
    return '<aside class="details-pane"><section class="details-section changes-section"><header><span>Changes</span><span class="count-badge">' + changes.length + '</span><span class="section-spacer"></span><button class="icon-button small" data-action="refreshChanges" title="Refresh changes">' + icon("refresh") + '</button></header><div class="changes-list">' + (session ? changeRows : '<div class="details-placeholder">Select a session to inspect changes.</div>') + '</div></section><section class="details-section session-details"><header><span>Session details</span></header>' + (session ? '<dl><div><dt>Provider</dt><dd>' + providerLogo(session.provider) + escapeHtml(providerName(session.provider)) + '</dd></div><div><dt>Workspace</dt><dd title="' + attr(session.workspace) + '">' + escapeHtml(shortPath(session.workspace)) + '</dd></div><div><dt>Permission</dt><dd>' + escapeHtml(permissionName(session.permission)) + '</dd></div><div><dt>Source</dt><dd>' + (session.source === "imported" ? "Imported history" : "Workbench") + '</dd></div>' + (session.nativeSessionId ? '<div><dt>Native ID</dt><dd class="mono" title="' + attr(session.nativeSessionId) + '">' + escapeHtml(session.nativeSessionId.slice(0, 12)) + '…</dd></div>' : "") + '</dl><div class="details-actions"><button class="secondary-button small-button" data-action="duplicateSession" data-session-id="' + attr(session.id) + '">' + icon("copy") + 'Duplicate</button><button class="secondary-button small-button" data-action="archiveSession" data-session-id="' + attr(session.id) + '">' + icon("archive") + (session.status === "archived" ? "Restore" : "Archive") + "</button></div>" : '<div class="details-placeholder">No active session</div>') + "</section></aside>";
  }

  function modal() {
    if (!state.modal) return "";
    if (state.modal === "sessionMenu") {
      const session = state.snapshot.sessions.find((item) => item.id === state.menuSessionId);
      if (!session) return "";
      return '<div class="modal-backdrop" data-action="closeModal"><div class="action-sheet modal-card" role="dialog" aria-modal="true" aria-label="Session actions" data-modal-card><header><div><h2>' + escapeHtml(session.title) + '</h2><p>' + escapeHtml(providerName(session.provider)) + '</p></div><button class="icon-button" data-action="closeModal">' + icon("close") + '</button></header><button data-action="duplicateSession" data-session-id="' + attr(session.id) + '">' + icon("copy") + '<span><strong>Duplicate</strong><small>Copy this conversation into a new local session</small></span></button><button data-action="archiveSession" data-session-id="' + attr(session.id) + '">' + icon("archive") + '<span><strong>' + (session.status === "archived" ? "Restore" : "Archive") + '</strong><small>Keep the transcript but remove it from active sessions</small></span></button><button class="danger-action" data-action="deleteSession" data-session-id="' + attr(session.id) + '">' + icon("trash") + '<span><strong>Delete from workbench</strong><small>Native CLI history is left untouched</small></span></button></div></div>';
    }
    if (state.modal === "import") {
      const body = state.importLoading ? '<div class="modal-loading"><span class="run-spinner"></span><span>Scanning configured user directories…</span></div>' : state.nativeSessions.length ? '<div class="native-list">' + state.nativeSessions.map((session) => '<button class="native-row" data-action="importNative" data-key="' + attr(session.key) + '">' + providerLogo(session.provider) + '<span><strong>' + escapeHtml(session.title) + '</strong><small>' + escapeHtml(shortPath(session.workspace)) + " · " + timeAgo(session.updatedAt) + '</small></span><span class="import-arrow">Import →</span></button>').join("") + "</div>" : '<div class="modal-empty"><strong>No unimported sessions found</strong><p>Sessions are scanned from the configured Claude and Codex user directories.</p><button class="secondary-button" data-action="discoverNative">' + icon("refresh") + "Scan again</button></div>";
      return '<div class="modal-backdrop" data-action="closeModal"><div class="modal-card import-modal" role="dialog" aria-modal="true" aria-label="Import local history" data-modal-card><header><div><h2>Import local history</h2><p>Resume sessions already created by Claude Code or Codex.</p></div><button class="icon-button" data-action="closeModal">' + icon("close") + "</button></header>" + body + "</div></div>";
    }
    const snapshot = state.snapshot;
    const preferred = state.newProvider || snapshot.config.defaultProvider;
    const workspaces = snapshot.workspaces;
    const fallbackWorkspace = workspaces.find((workspace) => workspace.active) || workspaces[0];
    const chosenWorkspace = state.workspacePicked || (fallbackWorkspace ? fallbackWorkspace.path : "");
    return '<div class="modal-backdrop" data-action="closeModal"><form id="new-session-form" class="modal-card new-session-modal" data-modal-card><header><div><h2>New local agent session</h2><p>Choose a CLI, workspace, and permission boundary.</p></div><button type="button" class="icon-button" data-action="closeModal">' + icon("close") + '</button></header><div class="form-body"><fieldset><legend>Agent</legend><div class="provider-choice"><label class="' + (preferred === "claude" ? "selected" : "") + '"><input type="radio" name="provider" value="claude" ' + (preferred === "claude" ? "checked" : "") + '><span>' + providerLogo("claude") + '<strong>Claude Code</strong><small>' + (snapshot.health.claude.available ? "Ready" : "CLI not found") + '</small></span></label><label class="' + (preferred === "codex" ? "selected" : "") + '"><input type="radio" name="provider" value="codex" ' + (preferred === "codex" ? "checked" : "") + '><span>' + providerLogo("codex") + '<strong>OpenAI Codex</strong><small>' + (snapshot.health.codex.available ? "Ready" : "CLI not found") + '</small></span></label></div></fieldset><label class="form-field"><span>Workspace</span><div class="field-with-button"><select id="new-workspace" name="workspace" required>' + (chosenWorkspace && !workspaces.some((item) => item.path === chosenWorkspace) ? '<option value="' + attr(chosenWorkspace) + '" selected>' + escapeHtml(chosenWorkspace) + '</option>' : '') + workspaces.map((workspace) => '<option value="' + attr(workspace.path) + '" ' + selected(chosenWorkspace, workspace.path) + '>' + escapeHtml(workspace.name + " — " + workspace.path) + '</option>').join('') + '</select><button type="button" class="secondary-button browse-button" data-action="pickWorkspace">' + icon("browse") + 'Browse</button></div></label><div class="form-grid"><label class="form-field"><span>Permission</span><select name="permission"><option value="plan" ' + selected(snapshot.config.defaultPermission, "plan") + '>Plan only</option><option value="read-only" ' + selected(snapshot.config.defaultPermission, "read-only") + '>Read only</option><option value="workspace-write" ' + selected(snapshot.config.defaultPermission, "workspace-write") + '>Workspace write</option><option value="full-access" ' + selected(snapshot.config.defaultPermission, "full-access") + '>Full access</option></select></label><label class="form-field"><span>Model <small>optional</small></span><input name="model" value="' + attr(snapshot.config.defaultModels[preferred] || "") + '" placeholder="Use CLI default"></label></div><label class="form-field"><span>Title <small>optional</small></span><input name="title" placeholder="New ' + escapeHtml(providerName(preferred)) + ' session"></label><div class="permission-notice"><strong>Workspace write</strong> lets the agent edit and run commands inside the selected directory. Full access disables provider sandboxing and requires confirmation.</div></div><footer><button type="button" class="secondary-button" data-action="closeModal">Cancel</button><button type="submit" class="primary-button">Create session</button></footer></form></div>';
  }

  function render(options) {
    if (!state.snapshot) return;
    const previousFocus = options && options.preserveFocus && document.activeElement && document.activeElement.id;
    const selection = previousFocus && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const classes = ["app", state.leftHidden ? "left-hidden" : "", state.rightHidden ? "right-hidden" : "", "density-" + state.snapshot.config.density].filter(Boolean).join(" ");
    app.className = classes;
    app.style.setProperty("--left-width", state.leftWidth + "px");
    app.style.setProperty("--right-width", state.rightWidth + "px");
    app.style.setProperty("--agent-accent", state.snapshot.config.accent);
    app.innerHTML = topbar() + '<div class="workbench-grid">' + sidebar() + '<div class="resize-handle left-resize" data-resize="left"></div>' + conversation() + '<div class="resize-handle right-resize" data-resize="right"></div>' + changesPane() + "</div>" + modal() + '<div id="toast-region" class="toast-region" aria-live="assertive"></div>';
    attachListeners();
    if (previousFocus) {
      const target = document.getElementById(previousFocus);
      if (target) {
        target.focus();
        if (selection && target.setSelectionRange) target.setSelectionRange(selection[0], selection[1]);
      }
    }
    scrollMessages();
  }

  function rerenderMessages() {
    const session = activeSession();
    const container = document.getElementById("message-list");
    if (!container || !session) return;
    container.innerHTML = session.messages.map((message) => messageCard(message, session)).join("");
    scrollMessages();
  }

  function scrollMessages() {
    const list = document.getElementById("message-list");
    if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function openNew(provider) {
    state.modal = "new";
    state.newProvider = provider || state.snapshot.config.defaultProvider;
    state.workspacePicked = "";
    render();
  }

  function closeModal() {
    state.modal = null;
    state.menuSessionId = null;
    render({ preserveFocus: true });
  }

  function showSessionMenu(sessionId) {
    state.menuSessionId = sessionId;
    state.modal = "sessionMenu";
    render();
  }

  function sendPrompt(prefill) {
    const session = activeSession();
    if (!session || session.status === "running") return;
    const input = document.getElementById("prompt-input");
    const prompt = typeof prefill === "string" ? prefill : input && input.value;
    if (!prompt || !prompt.trim()) return;
    state.drafts[session.id] = "";
    persist();
    post("sendPrompt", { sessionId: session.id, prompt: prompt.trim() });
    if (input) input.value = "";
  }

  function attachListeners() {
    app.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const button = event.currentTarget;
        const action = button.dataset.action;
        if (action === "closeModal" && button.classList.contains("modal-backdrop") && event.target !== button) return;
        if (action === "openNew") openNew();
        else if (action === "quickNew") openNew(button.dataset.provider);
        else if (action === "closeModal") closeModal();
        else if (action === "toggleLeft") { state.leftHidden = !state.leftHidden; persist(); render(); }
        else if (action === "toggleRight") { state.rightHidden = !state.rightHidden; persist(); render(); }
        else if (action === "settings") post("openSettings");
        else if (action === "output") post("showOutput");
        else if (action === "detach") post("detach");
        else if (action === "checkHealth") post("checkHealth");
        else if (action === "selectSession") post("selectSession", { sessionId: button.dataset.sessionId });
        else if (action === "filter") { state.filter = button.dataset.filter; persist(); render({ preserveFocus: true }); }
        else if (action === "send") sendPrompt();
        else if (action === "cancelRun") { const session = activeSession(); if (session) post("cancelRun", { sessionId: session.id }); }
        else if (action === "starter") { const input = document.getElementById("prompt-input"); if (input) { input.value = button.dataset.prompt; input.focus(); resizeTextarea(input); } }
        else if (action === "refreshChanges") post("refreshChanges");
        else if (action === "openFile") post("openFile", { path: button.dataset.path });
        else if (action === "openDiff") post("openDiff", { path: button.dataset.path });
        else if (action === "pickWorkspace") post("pickWorkspace");
        else if (action === "sessionMenu") showSessionMenu(button.dataset.sessionId);
        else if (action === "duplicateSession") { closeModal(); post("duplicateSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "archiveSession") { closeModal(); post("archiveSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "deleteSession") { closeModal(); post("deleteSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "import") { state.modal = "import"; state.importLoading = true; state.nativeSessions = []; render(); post("discoverNative"); }
        else if (action === "discoverNative") { state.importLoading = true; render(); post("discoverNative"); }
        else if (action === "importNative") { post("importNative", { key: button.dataset.key }); closeModal(); }
      });
    });

    const search = document.getElementById("session-search");
    if (search) search.addEventListener("input", () => { state.query = search.value; persist(); render({ preserveFocus: true }); });

    const prompt = document.getElementById("prompt-input");
    if (prompt) {
      resizeTextarea(prompt);
      prompt.addEventListener("input", () => {
        const session = activeSession();
        if (session) state.drafts[session.id] = prompt.value;
        persist();
        resizeTextarea(prompt);
      });
      prompt.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          sendPrompt();
        }
      });
    }

    const title = document.getElementById("session-title");
    const model = document.getElementById("session-model");
    const permission = document.getElementById("session-permission");
    if (title) title.addEventListener("change", updateActiveSession);
    if (model) model.addEventListener("change", updateActiveSession);
    if (permission) permission.addEventListener("change", updateActiveSession);

    const newForm = document.getElementById("new-session-form");
    if (newForm) {
      newForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(newForm);
        const workspace = String(data.get("workspace") || "");
        if (!workspace) { showToast("Choose a workspace first.", "error"); return; }
        post("newSession", {
          provider: String(data.get("provider") || "claude"),
          workspace,
          permission: String(data.get("permission") || "workspace-write"),
          model: String(data.get("model") || ""),
          title: String(data.get("title") || "")
        });
        closeModal();
      });
      newForm.querySelectorAll('input[name="provider"]').forEach((input) => input.addEventListener("change", () => {
        state.newProvider = input.value;
        render();
      }));
    }

    app.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", beginResize);
    });
  }

  function updateActiveSession() {
    const session = activeSession();
    if (!session) return;
    const title = document.getElementById("session-title");
    const model = document.getElementById("session-model");
    const permission = document.getElementById("session-permission");
    post("updateSession", {
      sessionId: session.id,
      title: title ? title.value : session.title,
      model: model ? model.value : session.model,
      permission: permission ? permission.value : session.permission
    });
  }

  function resizeTextarea(element) {
    element.style.height = "0";
    element.style.height = Math.min(element.scrollHeight, 220) + "px";
  }

  function beginResize(event) {
    const side = event.currentTarget.dataset.resize;
    const startX = event.clientX;
    const startWidth = side === "left" ? state.leftWidth : state.rightWidth;
    document.body.classList.add("resizing");
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") state.leftWidth = clamp(startWidth + delta, 220, 520);
      else state.rightWidth = clamp(startWidth - delta, 240, 560);
      app.style.setProperty(side === "left" ? "--left-width" : "--right-width", (side === "left" ? state.leftWidth : state.rightWidth) + "px");
    };
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function showToast(message, level) {
    let region = document.getElementById("toast-region");
    if (!region) return;
    region.innerHTML = '<div class="toast ' + attr(level || "info") + '">' + escapeHtml(message) + "</div>";
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { if (region) region.innerHTML = ""; }, 5000);
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "snapshot") {
      state.snapshot = message.snapshot;
      render();
    } else if (message.type === "health" && state.snapshot) {
      state.snapshot.health = message.health;
      render({ preserveFocus: true });
    } else if (message.type === "session" && state.snapshot) {
      updateSessionLocal(message.session);
      render({ preserveFocus: true });
    } else if (message.type === "sessionMeta" && state.snapshot) {
      const session = state.snapshot.sessions.find((item) => item.id === message.sessionId);
      if (session) Object.assign(session, message.patch);
      const active = activeSession();
      if (active && active.id === message.sessionId) {
        const statusTarget = document.querySelector(".composer");
        if (statusTarget && message.patch.status === "running") statusTarget.classList.add("running");
      }
    } else if (message.type === "messageDelta" && state.snapshot) {
      const session = state.snapshot.sessions.find((item) => item.id === message.sessionId);
      const item = session && session.messages.find((entry) => entry.id === message.messageId);
      if (item) item.content += message.delta;
      const body = document.querySelector('.message-body[data-message-id="' + CSS.escape(message.messageId) + '"]');
      if (body && item) body.innerHTML = formatMessage(item.content) + '<span class="stream-cursor"></span>';
      scrollMessages();
    } else if (message.type === "messageUpsert" && state.snapshot) {
      const session = state.snapshot.sessions.find((item) => item.id === message.sessionId);
      if (session) {
        const index = session.messages.findIndex((item) => item.id === message.message.id);
        if (index === -1) session.messages.push(message.message);
        else session.messages[index] = message.message;
      }
      if (activeSession() && activeSession().id === message.sessionId) rerenderMessages();
    } else if (message.type === "changes" && state.snapshot) {
      state.snapshot.changes = message.changes;
      render({ preserveFocus: true });
    } else if (message.type === "workspacePicked") {
      state.workspacePicked = message.workspace;
      render();
    } else if (message.type === "showNewSession") {
      openNew();
    } else if (message.type === "nativeSessions") {
      state.nativeSessions = message.sessions || [];
      state.importLoading = false;
      if (state.modal !== "import") state.modal = "import";
      render();
    } else if (message.type === "notification") {
      showToast(message.message, message.level);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modal) closeModal();
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      if (state.snapshot) openNew();
    }
  });

  post("ready");
})();
