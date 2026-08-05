(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const saved = vscode.getState() || {};
  const state = {
    snapshot: null,
    view: saved.view || "new",
    rightTab: saved.rightTab || "files",
    leftWidth: clamp(Number(saved.leftWidth) || Math.round(window.innerWidth * 0.21), 260, 440),
    rightWidth: clamp(Number(saved.rightWidth) || Math.round(window.innerWidth * 0.24), 300, 500),
    newDraft: saved.newDraft || "",
    newProvider: saved.newProvider || "",
    newPermission: saved.newPermission || "",
    newWorkspace: saved.newWorkspace || "",
    newModel: saved.newModel || "",
    newWorktree: saved.newWorktree !== false,
    autoCommit: saved.autoCommit !== false,
    sessionQuery: saved.sessionQuery || "",
    sessionFilter: saved.sessionFilter || "active",
    modal: null,
    menuSessionId: null,
    nativeSessions: [],
    importLoading: false,
    startingSession: false,
    editorContext: null,
    fileQuery: "",
    fileSearchOpen: false,
    directories: new Map(),
    expandedDirectories: new Set([""]),
    selectedCommit: null,
    commitFiles: new Map(),
    toastTimer: null
  };

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function persist() {
    vscode.setState({
      view: state.view,
      rightTab: state.rightTab,
      leftWidth: state.leftWidth,
      rightWidth: state.rightWidth,
      newDraft: state.newDraft,
      newProvider: state.newProvider,
      newPermission: state.newPermission,
      newWorkspace: state.newWorkspace,
      newModel: state.newModel,
      newWorktree: state.newWorktree,
      autoCommit: state.autoCommit,
      sessionQuery: state.sessionQuery,
      sessionFilter: state.sessionFilter
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
      agent: '<path d="M8 3h8v2h2.5A2.5 2.5 0 0121 7.5v8a2.5 2.5 0 01-2.5 2.5H16v2h-2v-2h-4v2H8v-2H5.5A2.5 2.5 0 013 15.5v-8A2.5 2.5 0 015.5 5H8V3zm-2.5 4a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h13a.5.5 0 00.5-.5v-8a.5.5 0 00-.5-.5h-13zM8 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm8 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/>',
      add: '<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z"/>',
      search: '<path d="M10.5 4a6.5 6.5 0 104.02 11.61L19.91 21 21 19.91l-5.39-5.39A6.5 6.5 0 0010.5 4zm0 1.5a5 5 0 110 10 5 5 0 010-10z"/>',
      tune: '<path d="M4 7h9a3 3 0 100-2H4v2zm0 6h3a3 3 0 100-2H4v2zm0 6h11a3 3 0 100-2H4v2zm9-13a1 1 0 110 2 1 1 0 010-2zm-6 6a1 1 0 110 2 1 1 0 010-2zm8 6a1 1 0 110 2 1 1 0 010-2z" transform="translate(0 -1)"/>',
      chat: '<path d="M4 4h12a3 3 0 013 3v6a3 3 0 01-3 3H9l-5 4v-4a3 3 0 01-2-2.8V7a3 3 0 013-3zm0 2a1 1 0 00-1 1v6a1 1 0 001 1h2v2l2.4-2H16a1 1 0 001-1V7a1 1 0 00-1-1H4z"/>',
      branch: '<path d="M6 3a3 3 0 012.8 4H15a3 3 0 110 2H8.8A3 3 0 017 10.8v2.4A3 3 0 119 16a3 3 0 01-2 2.8A3 3 0 015 16a3 3 0 012-2.8v-2.4A3 3 0 016 5a1 1 0 100 2 1 1 0 000-2z"/>',
      history: '<path d="M12 3a9 9 0 109 9h-2a7 7 0 11-2.05-4.95L14 10h7V3l-2.62 2.62A8.96 8.96 0 0012 3zm-1 4h2v5.4l3.5 2.1-1 1.7-4.5-2.7V7z"/>',
      changes: '<path d="M7 3h10v3h3v15H4V6h3V3zm2 2v3h6V5H9zM6 8v11h12V8h-1v2H7V8H6zm3 5h6v2H9v-2z"/>',
      folder: '<path d="M3 5h7l2 2h9v12H3V5zm2 2v10h14V9h-7.8l-2-2H5z"/>',
      file: '<path d="M6 2h8l5 5v15H6V2zm2 2v16h9V8h-4V4H8zm7 .8V6h1.2L15 4.8z"/>',
      chevron: '<path d="M8.6 5.6L15 12l-6.4 6.4-1.4-1.4 5-5-5-5 1.4-1.4z"/>',
      settings: '<path d="M10.9 2h2.2l.5 2.2c.5.2 1 .4 1.4.8l2.1-.7 1.1 1.9-1.7 1.5c.1.3.2.9.2 1.3s-.1 1-.2 1.3l1.7 1.5-1.1 1.9-2.1-.7c-.4.4-.9.6-1.4.8l-.5 2.2h-2.2l-.5-2.2c-.5-.2-1-.4-1.4-.8l-2.1.7-1.1-1.9 1.7-1.5c-.1-.3-.2-.9-.2-1.3s.1-1 .2-1.3L5.8 6.2l1.1-1.9L9 5c.4-.4.9-.6 1.4-.8l.5-2.2zM12 7a3 3 0 100 6 3 3 0 000-6z" transform="translate(0 3)"/>',
      output: '<path d="M4 5h16v14H4V5zm2 2v10h12V7H6zm1.2 3L9 11.8l-1.8 1.8 1.2 1.2 3-3-3-3L7.2 10zm5.8 4h4v1.5h-4V14z"/>',
      import: '<path d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3zM4 19h16v2H4v-2z"/>',
      send: '<path d="M12 4l7 7-1.4 1.4-4.6-4.6V20h-2V7.8l-4.6 4.6L5 11l7-7z"/>',
      stop: '<path d="M6 6h12v12H6z"/>',
      refresh: '<path d="M19 7V3l-1.8 1.8A8 8 0 104 17l1.5-1.3A6 6 0 1117.4 8H13V6h6v1z"/>',
      window: '<path d="M4 4h16v16H4V4zm2 4v10h12V8H6zm0-2h12V6H6z"/>',
      attach: '<path d="M8.5 18.5a5 5 0 010-7.1l6.4-6.4a3.5 3.5 0 115 5l-7.8 7.8a2 2 0 11-2.8-2.8l7.1-7.1 1.4 1.4-7.1 7.1 0 0a.02.02 0 000 .02.02.02 0 00.02 0l7.8-7.8a1.5 1.5 0 00-2.2-2.2L9.9 12.8a3 3 0 104.2 4.2l5.7-5.7 1.4 1.4-5.7 5.8a5 5 0 01-7 0z"/>',
      more: '<path d="M5 10a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4zm7 0a2 2 0 110 4 2 2 0 010-4z"/>',
      close: '<path d="M6.3 4.9L12 10.6l5.7-5.7 1.4 1.4-5.7 5.7 5.7 5.7-1.4 1.4-5.7-5.7-5.7 5.7-1.4-1.4 5.7-5.7-5.7-5.7 1.4-1.4z"/>',
      copy: '<path d="M8 3h11v14h-3v4H5V7h3V3zm2 4h6v8h1V5h-7v2zm-3 2v10h7V9H7z"/>',
      archive: '<path d="M4 3h16l2 4v2h-1v11H3V9H2V7l2-4zm1.3 2l-1 2h15.4l-1-2H5.3zM5 9v9h14V9H5zm4 2h6v2H9v-2z"/>',
      trash: '<path d="M8 3h8l1 2h4v2H3V5h4l1-2zm-2 6h12l-1 12H7L6 9zm3 2v8h2v-8H9zm4 0v8h2v-8h-2z"/>',
      commit: '<path d="M11 2h2v6.2a4 4 0 010 7.6V22h-2v-6.2a4 4 0 010-7.6V2zm1 8a2 2 0 100 4 2 2 0 000-4z"/>',
      check: '<path d="M9.2 18.2L3 12l1.4-1.4 4.8 4.8L19.6 5 21 6.4 9.2 18.2z"/>'
    };
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.file) + '</svg><span class="sr-only">' + escapeHtml(label || name) + '</span>';
  }

  function providerName(provider) {
    return provider === "codex" ? "Codex" : "Claude";
  }

  function providerLogo(provider) {
    return '<span class="provider-logo ' + attr(provider) + '" aria-hidden="true">' + (provider === "codex" ? "◎" : "A") + "</span>";
  }

  function permissionName(permission) {
    return ({ plan: "Plan", "read-only": "Read only", "workspace-write": "Default permissions", "full-access": "Full access" })[permission] || permission;
  }

  function timeAgo(timestamp) {
    const elapsed = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(elapsed)) return "";
    if (elapsed < 60_000) return "now";
    if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + "m";
    if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + "h";
    if (elapsed < 604_800_000) return Math.floor(elapsed / 86_400_000) + "d";
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function shortPath(value) {
    const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length > 3 ? "…/" + parts.slice(-3).join("/") : String(value || "");
  }

  function basename(value) {
    return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || value || "Workspace";
  }

  function selected(current, value) {
    return current === value ? "selected" : "";
  }

  function activeSession() {
    if (!state.snapshot) return null;
    return state.snapshot.sessions.find((session) => session.id === state.snapshot.activeSessionId) || null;
  }

  function selectedWorktree() {
    if (!state.snapshot) return null;
    return state.snapshot.worktrees.find((worktree) => worktree.path === state.snapshot.selectedWorktreePath)
      || state.snapshot.worktrees.find((worktree) => worktree.isMain)
      || state.snapshot.worktrees[0]
      || null;
  }

  function sessionsForWorktree(worktreePath) {
    if (!state.snapshot) return [];
    return state.snapshot.sessions
      .filter((session) => session.workspace === worktreePath && session.status !== "archived")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function formatMessage(value) {
    const chunks = String(value || "").split(/(```[\s\S]*?```)/g);
    return chunks.map((chunk) => {
      if (chunk.startsWith("```") && chunk.endsWith("```")) {
        const body = chunk.slice(3, -3);
        const firstBreak = body.indexOf("\n");
        const language = firstBreak >= 0 ? body.slice(0, firstBreak).trim() : "";
        const code = firstBreak >= 0 ? body.slice(firstBreak + 1) : body;
        return '<div class="code-block"><div class="code-caption">' + escapeHtml(language || "code") + '</div><pre><code>' + escapeHtml(code) + "</code></pre></div>";
      }
      let safe = escapeHtml(chunk)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/^### (.+)$/gm, "<h4>$1</h4>")
        .replace(/^## (.+)$/gm, "<h3>$1</h3>")
        .replace(/^# (.+)$/gm, "<h2>$1</h2>")
        .replace(/^[-*] (.+)$/gm, '<span class="list-line">• $1</span>')
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      return '<div class="prose-lines">' + safe.replace(/\n/g, "<br>") + "</div>";
    }).join("");
  }

  function worktreeRow(worktree) {
    const current = selectedWorktree();
    const isSelected = current && current.path === worktree.path;
    const sessions = sessionsForWorktree(worktree.path);
    const running = sessions.filter((session) => session.status === "running").length;
    const stateText = running ? running + " agent" + (running === 1 ? "" : "s") + " running" : sessions.length ? sessions.length + " agent" + (sessions.length === 1 ? "" : "s") : worktree.isMain ? "Primary worktree" : "Ready";
    return '<button class="worktree-row ' + (isSelected ? "active" : "") + '" data-action="selectWorktree" data-path="' + attr(worktree.path) + '"><span class="worktree-icon">' + icon("branch") + (running ? '<span class="activity-dot"></span>' : "") + '</span><span class="worktree-copy"><strong>' + escapeHtml(worktree.branch) + '</strong><small>' + escapeHtml(stateText) + '</small></span>' + (worktree.dirtyCount ? '<span class="dirty-badge" title="' + worktree.dirtyCount + ' changed files">' + worktree.dirtyCount + "</span>" : "") + (worktree.isMain ? '<span class="main-badge">main</span>' : "") + "</button>";
  }

  function agentRow(session) {
    const active = session.id === state.snapshot.activeSessionId && state.view === "chat";
    return '<div class="agent-row ' + (active ? "active" : "") + '"><button class="agent-main" data-action="selectSession" data-session-id="' + attr(session.id) + '">' + providerLogo(session.provider) + '<span><strong>' + escapeHtml(session.title) + '</strong><small>' + (session.status === "running" ? '<span class="run-spinner"></span>' + escapeHtml(session.statusText || "Working") : escapeHtml(providerName(session.provider) + " · " + timeAgo(session.updatedAt))) + '</small></span></button><button class="row-more" data-action="sessionMenu" data-session-id="' + attr(session.id) + '">' + icon("more") + "</button></div>";
  }

  function sidebar() {
    const worktrees = state.snapshot.worktrees || [];
    const current = selectedWorktree();
    const agents = current ? sessionsForWorktree(current.path) : [];
    return '<aside class="left-pane"><header class="pane-title"><strong>Worktrees</strong><span class="pane-title-actions"><button class="new-button" data-action="openNew" data-worktree="true">New <kbd>⌘N</kbd></button><button class="icon-button" data-action="cycleFilter" title="Filter agents">' + icon("tune") + '</button><button class="icon-button" data-action="focusAgentSearch" title="Search agents">' + icon("search") + '</button></span></header>' +
      '<div class="left-scroll"><section class="nav-section"><button class="nav-row ' + (state.view === "new" ? "active" : "") + '" data-action="openNew" data-worktree="true">' + icon("add") + '<span>New parallel task</span></button><button class="nav-row ' + (state.view === "history" ? "active" : "") + '" data-action="showHistory">' + icon("history") + '<span>Repository history</span><span class="nav-count">' + state.snapshot.commits.length + "</span></button></section>" +
      '<section class="worktree-section"><div class="section-label">Repository worktrees <span>' + worktrees.length + '</span></div><div class="worktree-list">' + (worktrees.length ? worktrees.map(worktreeRow).join("") : '<div class="sidebar-empty">Open a Git repository to manage worktrees.</div>') + "</div></section>" +
      '<section class="agents-section"><div class="section-label">Agents on selected worktree <span>' + agents.length + '</span></div><label class="agent-search ' + (state.sessionQuery ? "visible" : "") + '">' + icon("search") + '<input id="agent-search" value="' + attr(state.sessionQuery) + '" placeholder="Filter agents"></label><div class="agent-list">' + (agents.filter((session) => !state.sessionQuery || session.title.toLowerCase().includes(state.sessionQuery.toLowerCase())).map(agentRow).join("") || '<div class="sidebar-empty compact">No agents on this worktree.</div>') + "</div></section></div>" +
      '<footer class="left-footer"><div class="section-label">Tools</div><button class="nav-row" data-action="import">' + icon("import") + '<span>Import agent history</span></button><button class="nav-row" data-action="settings">' + icon("settings") + '<span>Agent settings</span></button><button class="nav-row" data-action="output">' + icon("output") + '<span>Agent output</span></button></footer></aside>';
  }

  function contextChip() {
    if (!state.editorContext) return "";
    const context = state.editorContext;
    return '<div class="context-chip" title="' + attr(context.path) + '">' + icon("file") + '<span>' + escapeHtml(basename(context.path)) + ":" + context.startLine + (context.endLine !== context.startLine ? "–" + context.endLine : "") + '</span><button data-action="clearContext" title="Remove context">' + icon("close") + "</button></div>";
  }

  function workspaceOptions(current) {
    const entries = new Map();
    (state.snapshot.worktrees || []).forEach((item) => entries.set(item.path, { path: item.path, name: item.branch }));
    (state.snapshot.workspaces || []).forEach((item) => { if (!entries.has(item.path)) entries.set(item.path, item); });
    if (current && !entries.has(current)) entries.set(current, { path: current, name: basename(current) });
    return [...entries.values()].map((workspace) => '<option value="' + attr(workspace.path) + '" ' + selected(current, workspace.path) + '>' + escapeHtml(workspace.name || basename(workspace.path)) + "</option>").join("");
  }

  function newSessionView() {
    const currentWorktree = selectedWorktree();
    const workspace = state.newWorkspace || (currentWorktree && currentWorktree.path) || state.snapshot.workspaces[0]?.path || "";
    const provider = state.newProvider || state.snapshot.config.defaultProvider;
    const permission = state.newPermission || state.snapshot.config.defaultPermission;
    const canCommit = permission === "workspace-write" || permission === "full-access";
    const health = state.snapshot.health[provider];
    return '<main class="center-pane new-session-view"><div class="corner-agent">' + icon("agent") + '</div><section class="new-session-card"><div class="new-session-title">New agent in <label class="inline-select folder-select">' + icon("folder") + '<select id="new-workspace">' + workspaceOptions(workspace) + '</select>' + icon("chevron") + '</label> with <label class="inline-select provider-select">' + providerLogo(provider) + '<select id="new-provider"><option value="codex" ' + selected(provider, "codex") + '>Codex</option><option value="claude" ' + selected(provider, "claude") + '>Claude</option></select>' + icon("chevron") + "</label></div>" +
      '<div class="prompt-shell"><div class="tip-line"><strong>Tip:</strong> Select code in an editor, then use <span>＋</span> to attach it as precise feedback context.</div><div class="new-composer">' + contextChip() + '<textarea id="new-prompt" rows="3" placeholder="What will this agent complete?">' + escapeHtml(state.newDraft) + '</textarea><div class="new-composer-footer"><div class="composer-tools"><button class="composer-icon" data-action="captureEditorSelection" title="Attach the current editor selection">' + icon("add") + '</button><span class="composer-mode">' + icon("agent") + 'Agent</span><label class="composer-mode model-control"><span>◎</span><input id="new-model" value="' + attr(state.newModel || state.snapshot.config.defaultModels[provider] || "") + '" placeholder="Auto" title="Optional model"></label></div><button class="submit-arrow ' + (!state.newDraft.trim() || state.startingSession || !health.available ? "disabled" : "") + '" data-action="createAndRun" title="' + attr(health.available ? "Start agent" : providerName(provider) + " CLI is unavailable") + '">' + (state.startingSession ? '<span class="run-spinner"></span>' : icon("send")) + "</button></div></div></div>" +
      '<div class="new-meta"><div><span class="meta-control">' + icon("chat") + 'Interactive</span><label class="meta-control">' + icon("check") + '<select id="new-permission"><option value="plan" ' + selected(permission, "plan") + '>Plan only</option><option value="read-only" ' + selected(permission, "read-only") + '>Read only</option><option value="workspace-write" ' + selected(permission, "workspace-write") + '>Default permissions</option><option value="full-access" ' + selected(permission, "full-access") + '>Full access</option></select></label></div><div><label class="worktree-toggle ' + (!canCommit ? "disabled" : "") + '"><input id="auto-commit" type="checkbox" ' + (state.autoCommit && canCommit ? "checked" : "") + (!canCommit ? " disabled" : "") + '><span>' + icon("check") + '</span> Commit result</label><label class="worktree-toggle"><input id="new-worktree" type="checkbox" ' + (state.newWorktree ? "checked" : "") + '><span>' + icon("check") + '</span> New Worktree</label><span class="meta-control branch-name">' + icon("branch") + escapeHtml(state.snapshot.branch || currentWorktree?.branch || "main") + "</span></div></div>" +
      '<p class="new-session-note">' + (state.newWorktree ? "A new branch and sibling worktree will be created before the agent starts." : "The agent will work directly in the selected worktree.") + "</p></section></main>";
  }

  function messageCard(message, session) {
    const roleName = ({ user: "You", assistant: providerName(session.provider), reasoning: "Reasoning", tool: message.title || "Tool", system: "System", error: message.title || "Error" })[message.role] || message.role;
    const body = '<div class="message-body" data-message-id="' + attr(message.id) + '">' + formatMessage(message.content) + (message.state === "running" && message.role === "assistant" ? '<span class="stream-cursor"></span>' : "") + "</div>";
    if (message.role === "tool" || message.role === "reasoning") {
      return '<details class="message-card compact-card" ' + (message.state === "running" ? "open" : "") + '><summary><span class="tool-state ' + attr(message.state || "completed") + '"></span><span>' + escapeHtml(roleName) + '</span><span class="summary-spacer"></span><span class="message-time">' + timeAgo(message.createdAt) + "</span></summary>" + body + "</details>";
    }
    return '<article class="message-card ' + attr(message.role) + '"><header><span class="message-author">' + (message.role === "assistant" ? providerLogo(session.provider) : '<span class="role-icon">' + (message.role === "user" ? "Y" : "!") + "</span>") + '<strong>' + escapeHtml(roleName) + '</strong></span><span class="message-time">' + timeAgo(message.createdAt) + "</span></header>" + body + "</article>";
  }

  function conversationView() {
    const session = activeSession();
    if (!session) return worktreeView();
    const running = session.status === "running";
    const draft = state.newDraft || "";
    const messages = session.messages.length
      ? session.messages.map((item) => messageCard(item, session)).join("")
      : '<div class="empty-conversation">Agent ready on <strong>' + escapeHtml(session.workspace) + "</strong></div>";
    const runButton = running
      ? '<button class="stop-button" data-action="cancelRun">' + icon("stop") + " Stop</button>"
      : '<button class="submit-arrow" data-action="sendPrompt">' + icon("send") + "</button>";
    return '<main class="center-pane conversation-view">' +
      '<header class="conversation-header"><div><span class="eyebrow">' + escapeHtml(basename(session.workspace)) + " · " + escapeHtml(session.provider) + '</span><input id="session-title" value="' + attr(session.title) + '" aria-label="Agent title"></div>' +
      '<div class="header-actions"><button class="secondary-button" data-action="openWorktree" data-path="' + attr(session.workspace) + '">' + icon("window") + 'Open worktree</button><button class="icon-button" data-action="sessionMenu" data-session-id="' + attr(session.id) + '">' + icon("more") + "</button></div></header>" +
      '<div id="message-list" class="message-list">' + messages + "</div>" +
      '<div class="conversation-composer-wrap"><div class="conversation-composer">' + contextChip() + '<textarea id="prompt-input" rows="1" placeholder="Give feedback or assign the next step…" ' + (running ? "disabled" : "") + ">" + escapeHtml(draft) + '</textarea><div><button class="composer-icon" data-action="captureEditorSelection" title="Attach editor selection">' + icon("add") + '</button><span class="composer-branch">' + icon("branch") + escapeHtml(state.snapshot.branch || basename(session.workspace)) + '</span><span class="permission-badge">' + escapeHtml(permissionName(session.permission)) + "</span>" + runButton + "</div></div></div></main>";
  }

  function worktreeView() {
    const worktree = selectedWorktree();
    if (!worktree) return newSessionView();
    const agents = sessionsForWorktree(worktree.path);
    const recent = state.snapshot.commits.slice(0, 5);
    const agentMarkup = agents.length
      ? agents.map((session) => `<button class="dashboard-agent" data-action="selectSession" data-session-id="${attr(session.id)}">${providerLogo(session.provider)}<span><strong>${escapeHtml(session.title)}</strong><small>${session.status === "running" ? escapeHtml(session.statusText || "Working") : "Updated " + timeAgo(session.updatedAt)}</small></span><span class="agent-state ${attr(session.status)}">${session.status === "running" ? "Running" : session.status === "error" ? "Needs attention" : "Ready"}</span></button>`).join("")
      : '<div class="card-empty">No agent has worked in this tree yet.<button data-action="openNew" data-worktree="false">Start one here</button></div>';
    const changesMarkup = state.snapshot.changes.length
      ? state.snapshot.changes.slice(0, 8).map((change) => `<button data-action="openDiff" data-path="${attr(change.path)}"><span class="change-status">${escapeHtml(change.status)}</span><span>${escapeHtml(change.path)}</span></button>`).join("")
      : `<div class="clean-state">${icon("check")} No uncommitted changes</div>`;
    const historyMarkup = recent.length ? recent.map(commitRow).join("") : '<div class="card-empty">No commits found.</div>';
    return `<main class="center-pane worktree-view">
      <header class="worktree-header">
        <div class="worktree-heading"><span class="worktree-hero-icon">${icon("branch")}</span><div><span class="eyebrow">Selected worktree</span><h1>${escapeHtml(worktree.branch)}</h1><p>${escapeHtml(worktree.path)}</p></div></div>
        <div class="header-actions"><button class="secondary-button" data-action="openWorktree" data-path="${attr(worktree.path)}">${icon("window")}Open in VS Code</button><button class="primary-button" data-action="openNew" data-worktree="false">${icon("add")}New agent here</button></div>
      </header>
      <div class="worktree-dashboard">
        <section class="dashboard-card"><header><span>Agent activity</span><strong>${agents.length}</strong></header><div class="dashboard-body">${agentMarkup}</div></section>
        <section class="dashboard-card"><header><span>Working tree</span><strong>${state.snapshot.changes.length}</strong></header><div class="dashboard-body changes-summary">${changesMarkup}</div></section>
        <section class="dashboard-card dashboard-history"><header><span>Recent repository history</span><button data-action="showHistory">View graph</button></header><div class="dashboard-body">${historyMarkup}</div></section>
      </div>
    </main>`;
  }

  function commitRow(commit) {
    return '<button class="mini-commit" data-action="selectCommit" data-hash="' + attr(commit.hash) + '"><span class="commit-node"></span><span><strong>' + escapeHtml(commit.subject) + '</strong><small><code>' + escapeHtml(commit.hash.slice(0, 7)) + "</code> · " + escapeHtml(commit.author) + " · " + timeAgo(commit.date) + "</small></span>" + (commit.refs[0] ? '<span class="ref-label">' + escapeHtml(commit.refs[0].replace(/^HEAD -> /, "")) + "</span>" : "") + "</button>";
  }

  function historyRows() {
    const commits = state.snapshot.commits || [];
    const lanes = [];
    return commits.map((commit) => {
      let lane = lanes.indexOf(commit.hash);
      if (lane === -1) {
        lane = lanes.findIndex((item) => !item);
        if (lane === -1) lane = lanes.length;
      }
      lanes[lane] = commit.parents[0] || null;
      commit.parents.slice(1).forEach((parent) => {
        if (!lanes.includes(parent)) lanes.splice(lane + 1, 0, parent);
      });
      while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
      const laneMarkup = Array.from({ length: Math.max(lanes.length, lane + 1, 1) }, (_, index) => '<span class="lane ' + (index === lane ? "current" : "") + '">' + (index === lane ? '<i></i>' : "") + "</span>").join("");
      return '<button class="history-row ' + (state.selectedCommit === commit.hash ? "active" : "") + '" data-action="selectCommit" data-hash="' + attr(commit.hash) + '"><span class="graph-cell" style="--lane:' + lane + '">' + laneMarkup + '</span><span class="commit-copy"><strong>' + escapeHtml(commit.subject) + '<span class="commit-refs">' + commit.refs.slice(0, 3).map((ref) => '<em>' + escapeHtml(ref.replace(/^HEAD -> /, "")) + "</em>").join("") + '</span></strong><small><code>' + escapeHtml(commit.hash.slice(0, 8)) + "</code><span>" + escapeHtml(commit.author) + "</span><span>" + timeAgo(commit.date) + "</span></small></span></button>";
    }).join("");
  }

  function historyView() {
    const rows = state.snapshot.commits.length ? historyRows() : '<div class="history-empty">No Git history was found for this workspace.</div>';
    return `<main class="center-pane history-view"><header class="history-header"><div><span class="eyebrow">Repository</span><h1>Version history</h1><p>Commits across every branch and agent worktree.</p></div><div class="header-actions"><button class="secondary-button" data-action="refreshRepository">${icon("refresh")}Refresh</button></div></header><div class="history-column-header"><span>Graph</span><span>Commit</span></div><div class="history-list">${rows}</div></main>`;
  }

  function centerPane() {
    if (state.view === "history") return historyView();
    if (state.view === "chat") return conversationView();
    if (state.view === "worktree") return worktreeView();
    return newSessionView();
  }

  function fileRows(entries, depth) {
    const needle = state.fileQuery.trim().toLowerCase();
    return (entries || []).map((entry) => {
      const isDirectory = entry.type === "directory";
      const expanded = state.expandedDirectories.has(entry.path);
      const children = state.directories.get(entry.path) || [];
      const childMarkup = isDirectory && expanded ? fileRows(children, depth + 1) : "";
      const matches = !needle || entry.path.toLowerCase().includes(needle);
      if (needle && !matches && !childMarkup) return "";
      return '<div class="file-node"><button class="file-row ' + (isDirectory ? "directory" : "") + '" style="--depth:' + depth + '" data-action="' + (isDirectory ? "toggleDirectory" : "openFile") + '" data-path="' + attr(entry.path) + '" title="' + attr(entry.path) + '"><span class="tree-chevron">' + (isDirectory ? icon("chevron") : "") + '</span>' + icon(isDirectory ? "folder" : "file") + '<span>' + escapeHtml(entry.name) + "</span></button>" + childMarkup + "</div>";
    }).join("");
  }

  function changesPanel() {
    const changes = state.snapshot.changes || [];
    return '<div class="right-content changes-content">' + (changes.length ? changes.map((change) => '<div class="change-row"><button data-action="openDiff" data-path="' + attr(change.path) + '"><span class="change-status ' + (change.untracked ? "untracked" : change.staged ? "staged" : "") + '">' + escapeHtml(change.status) + '</span><span>' + escapeHtml(change.path) + '</span></button><button class="icon-button" data-action="openFile" data-path="' + attr(change.path) + '">' + icon("file") + "</button></div>").join("") : '<div class="right-empty">' + icon("check") + '<strong>Worktree clean</strong><span>No uncommitted files detected</span></div>') + "</div>";
  }

  function filesPanel() {
    const workspace = state.snapshot.fileWorkspace;
    return '<div class="right-content files-content">' + (state.fileSearchOpen ? '<label class="file-search">' + icon("search") + '<input id="file-search" value="' + attr(state.fileQuery) + '" placeholder="Filter loaded files"></label>' : "") + (workspace ? '<button class="root-row" data-action="toggleRoot">' + icon("chevron") + '<strong>' + escapeHtml(workspace.name) + '</strong><small>' + escapeHtml(state.snapshot.branch || "") + "</small></button>" + (state.expandedDirectories.has("") ? '<div class="file-tree">' + fileRows(state.directories.get("") || state.snapshot.files || [], 0) + "</div>" : "") : '<div class="right-empty">Open a workspace to browse files.</div>') + "</div>";
  }

  function commitPanel() {
    const commit = state.snapshot.commits.find((item) => item.hash === state.selectedCommit);
    const files = state.commitFiles.get(state.selectedCommit) || [];
    if (!commit) return '<div class="right-empty">Select a commit from history.</div>';
    return '<div class="right-content commit-content"><div class="commit-summary"><code>' + escapeHtml(commit.hash.slice(0, 10)) + '</code><h3>' + escapeHtml(commit.subject) + '</h3><p>' + escapeHtml(commit.author) + " · " + new Date(commit.date).toLocaleString() + "</p>" + commit.refs.map((ref) => '<span class="ref-label">' + escapeHtml(ref) + "</span>").join("") + '</div><div class="commit-files"><div class="section-label">Changed files <span>' + files.length + "</span></div>" + (files.length ? files.map((file) => '<button data-action="openCommitFile" data-hash="' + attr(commit.hash) + '" data-path="' + attr(file.path) + '">' + icon("file") + '<span>' + escapeHtml(file.path) + '</span><small><b>+' + file.additions + "</b> <i>-" + file.deletions + "</i></small></button>").join("") : '<div class="sidebar-empty">Loading commit files…</div>') + "</div></div>";
  }

  function rightPane() {
    const selectedCommit = Boolean(state.selectedCommit);
    const tab = selectedCommit && state.rightTab === "commit" ? "commit" : state.rightTab;
    return '<aside class="right-pane"><header class="right-tabs"><div><button class="' + (tab === "changes" ? "active" : "") + '" data-action="rightTab" data-tab="changes">Changes' + (state.snapshot.changes.length ? '<span>' + state.snapshot.changes.length + "</span>" : "") + '</button><button class="' + (tab === "files" ? "active" : "") + '" data-action="rightTab" data-tab="files">Files</button>' + (selectedCommit ? '<button class="' + (tab === "commit" ? "active" : "") + '" data-action="rightTab" data-tab="commit">Commit</button>' : "") + '</div><span><button class="icon-button" data-action="refreshRepository" title="Refresh repository">' + icon("refresh") + '</button><button class="icon-button" data-action="toggleFileSearch" title="Search files">' + icon("search") + '</button><button class="icon-button" data-action="openWorktree" title="Open worktree in VS Code">' + icon("window") + "</button></span></header>" + (tab === "changes" ? changesPanel() : tab === "commit" ? commitPanel() : filesPanel()) + "</aside>";
  }

  function modal() {
    if (state.modal === "sessionMenu") {
      const session = state.snapshot.sessions.find((item) => item.id === state.menuSessionId);
      if (!session) return "";
      return '<div class="modal-backdrop" data-action="closeModal"><div class="modal-card action-sheet" data-modal-card><header><div><h2>' + escapeHtml(session.title) + '</h2><p>' + escapeHtml(providerName(session.provider)) + " on " + escapeHtml(basename(session.workspace)) + '</p></div><button class="icon-button" data-action="closeModal">' + icon("close") + '</button></header><button data-action="duplicateSession" data-session-id="' + attr(session.id) + '">' + icon("copy") + '<span><strong>Duplicate agent</strong><small>Copy this transcript into a new agent session</small></span></button><button data-action="archiveSession" data-session-id="' + attr(session.id) + '">' + icon("archive") + '<span><strong>Archive</strong><small>Hide this agent while retaining its transcript</small></span></button><button class="danger-action" data-action="deleteSession" data-session-id="' + attr(session.id) + '">' + icon("trash") + '<span><strong>Delete from workbench</strong><small>The Git worktree and provider history are preserved</small></span></button></div></div>';
    }
    if (state.modal === "import") {
      const body = state.importLoading ? '<div class="modal-loading"><span class="run-spinner"></span>Scanning local agent history…</div>' : state.nativeSessions.length ? '<div class="native-list">' + state.nativeSessions.map((session) => '<button class="native-row" data-action="importNative" data-key="' + attr(session.key) + '">' + providerLogo(session.provider) + '<span><strong>' + escapeHtml(session.title) + '</strong><small>' + escapeHtml(shortPath(session.workspace)) + " · " + timeAgo(session.updatedAt) + '</small></span><em>Import →</em></button>').join("") + "</div>" : '<div class="modal-empty"><strong>No unimported sessions found</strong><p>Configured Claude and Codex history directories were scanned.</p><button class="secondary-button" data-action="discoverNative">' + icon("refresh") + "Scan again</button></div>";
      return '<div class="modal-backdrop" data-action="closeModal"><div class="modal-card import-modal" data-modal-card><header><div><h2>Import agent history</h2><p>Connect an existing CLI session to its worktree.</p></div><button class="icon-button" data-action="closeModal">' + icon("close") + "</button></header>" + body + "</div></div>";
    }
    return "";
  }

  function render(options) {
    if (!state.snapshot) return;
    const focusId = options && options.preserveFocus && document.activeElement && document.activeElement.id;
    const selection = focusId && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    app.className = "app density-" + state.snapshot.config.density;
    app.style.setProperty("--left-width", state.leftWidth + "px");
    app.style.setProperty("--right-width", state.rightWidth + "px");
    app.style.setProperty("--agent-accent", state.snapshot.config.accent);
    app.innerHTML = '<div class="workbench-grid">' + sidebar() + '<div class="resize-handle" data-resize="left"></div>' + centerPane() + '<div class="resize-handle" data-resize="right"></div>' + rightPane() + '</div>' + modal() + '<div id="toast-region" class="toast-region" aria-live="assertive"></div>';
    attachListeners();
    if (focusId) {
      const target = document.getElementById(focusId);
      if (target) {
        target.focus();
        if (selection && target.setSelectionRange) target.setSelectionRange(selection[0], selection[1]);
      }
    }
    resizeVisibleTextareas();
    scrollMessages();
  }

  function resizeVisibleTextareas() {
    [document.getElementById("new-prompt"), document.getElementById("prompt-input")].filter(Boolean).forEach(resizeTextarea);
  }

  function resizeTextarea(element) {
    element.style.height = "0";
    element.style.height = Math.min(element.scrollHeight, 240) + "px";
  }

  function scrollMessages() {
    const list = document.getElementById("message-list");
    if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function openNew(createWorktree) {
    const current = selectedWorktree();
    state.view = "new";
    state.newWorkspace = (current && current.path) || state.newWorkspace || state.snapshot.workspaces[0]?.path || "";
    if (typeof createWorktree === "boolean") state.newWorktree = createWorktree;
    state.newProvider = state.newProvider || state.snapshot.config.defaultProvider;
    state.newPermission = state.newPermission || state.snapshot.config.defaultPermission;
    persist();
    render();
    requestAnimationFrame(() => document.getElementById("new-prompt")?.focus());
  }

  function appendContext(prompt) {
    if (!state.editorContext) return prompt;
    const context = state.editorContext;
    return prompt + "\n\nFocus context from " + context.path + ":" + context.startLine + (context.endLine !== context.startLine ? "-" + context.endLine : "") + ":\n```\n" + context.text + "\n```";
  }

  function preparePrompt(prompt, permission) {
    const withContext = appendContext(prompt);
    if (!state.autoCommit || (permission !== "workspace-write" && permission !== "full-access")) return withContext;
    return withContext + "\n\nAfter completing and verifying the task, commit the intended changes on the current branch with a concise commit message. Do not commit unrelated pre-existing changes.";
  }

  function createAndRun() {
    if (state.startingSession) return;
    const prompt = state.newDraft.trim();
    const workspace = state.newWorkspace || selectedWorktree()?.path;
    if (!prompt || !workspace) {
      showToast("Choose a worktree and describe the task.", "error");
      return;
    }
    state.startingSession = true;
    persist();
    render({ preserveFocus: true });
    post("newSession", {
      provider: state.newProvider || state.snapshot.config.defaultProvider,
      workspace,
      permission: state.newPermission || state.snapshot.config.defaultPermission,
      model: state.newModel,
      prompt: preparePrompt(prompt, state.newPermission || state.snapshot.config.defaultPermission),
      newWorktree: state.newWorktree
    });
  }

  function sendPrompt() {
    const session = activeSession();
    if (!session || session.status === "running" || !state.newDraft.trim()) return;
    post("sendPrompt", { sessionId: session.id, prompt: preparePrompt(state.newDraft.trim(), session.permission) });
    state.newDraft = "";
    state.editorContext = null;
    persist();
    render();
  }

  function showSessionMenu(sessionId) {
    state.menuSessionId = sessionId;
    state.modal = "sessionMenu";
    render();
  }

  function closeModal() {
    state.modal = null;
    state.menuSessionId = null;
    render({ preserveFocus: true });
  }

  function selectWorktree(pathValue) {
    state.snapshot.selectedWorktreePath = pathValue;
    state.view = "worktree";
    state.directories = new Map();
    state.expandedDirectories = new Set([""]);
    state.selectedCommit = null;
    persist();
    render();
    post("selectWorktree", { path: pathValue });
  }

  function selectCommit(hash) {
    state.selectedCommit = hash;
    state.rightTab = "commit";
    persist();
    render();
    if (!state.commitFiles.has(hash)) post("loadCommit", { hash });
  }

  function toggleDirectory(pathValue) {
    if (state.expandedDirectories.has(pathValue)) {
      state.expandedDirectories.delete(pathValue);
    } else {
      state.expandedDirectories.add(pathValue);
      if (!state.directories.has(pathValue)) post("listDirectory", { path: pathValue });
    }
    render({ preserveFocus: true });
  }

  function attachListeners() {
    app.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", (event) => {
        const button = event.currentTarget;
        const action = button.dataset.action;
        if (action === "closeModal" && button.classList.contains("modal-backdrop") && event.target !== button) return;
        if (action === "openNew") openNew(button.dataset.worktree !== "false");
        else if (action === "selectWorktree") selectWorktree(button.dataset.path);
        else if (action === "selectSession") { state.view = "chat"; persist(); post("selectSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "showHistory") { state.view = "history"; persist(); render(); }
        else if (action === "createAndRun") createAndRun();
        else if (action === "sendPrompt") sendPrompt();
        else if (action === "cancelRun") { const session = activeSession(); if (session) post("cancelRun", { sessionId: session.id }); }
        else if (action === "captureEditorSelection") post("captureEditorSelection");
        else if (action === "clearContext") { state.editorContext = null; render({ preserveFocus: true }); }
        else if (action === "rightTab") { state.rightTab = button.dataset.tab; persist(); render(); }
        else if (action === "toggleFileSearch") { state.fileSearchOpen = !state.fileSearchOpen; render(); requestAnimationFrame(() => document.getElementById("file-search")?.focus()); }
        else if (action === "toggleDirectory") toggleDirectory(button.dataset.path);
        else if (action === "toggleRoot") { state.expandedDirectories.has("") ? state.expandedDirectories.delete("") : state.expandedDirectories.add(""); render(); }
        else if (action === "openFile") post("openFile", { path: button.dataset.path });
        else if (action === "openCommitFile") post("openCommitFile", { hash: button.dataset.hash, path: button.dataset.path });
        else if (action === "openDiff") post("openDiff", { path: button.dataset.path });
        else if (action === "refreshRepository") post("refreshRepository");
        else if (action === "openWorktree") post("openWorktree", { path: button.dataset.path || state.snapshot.selectedWorktreePath, newWindow: true });
        else if (action === "selectCommit") selectCommit(button.dataset.hash);
        else if (action === "settings") post("openSettings");
        else if (action === "output") post("showOutput");
        else if (action === "focusAgentSearch") { state.sessionQuery = state.sessionQuery || " "; render(); requestAnimationFrame(() => { const input = document.getElementById("agent-search"); if (input) { input.value = state.sessionQuery.trim(); input.focus(); } }); }
        else if (action === "cycleFilter") { state.sessionFilter = state.sessionFilter === "active" ? "all" : "active"; showToast("Agent filter: " + state.sessionFilter, "info"); }
        else if (action === "sessionMenu") { event.stopPropagation(); showSessionMenu(button.dataset.sessionId); }
        else if (action === "closeModal") closeModal();
        else if (action === "duplicateSession") { closeModal(); post("duplicateSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "archiveSession") { closeModal(); post("archiveSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "deleteSession") { closeModal(); post("deleteSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "import") { state.modal = "import"; state.importLoading = true; state.nativeSessions = []; render(); post("discoverNative"); }
        else if (action === "discoverNative") { state.importLoading = true; render(); post("discoverNative"); }
        else if (action === "importNative") { post("importNative", { key: button.dataset.key }); closeModal(); }
      });
    });

    const newPrompt = document.getElementById("new-prompt");
    const prompt = document.getElementById("prompt-input");
    [newPrompt, prompt].filter(Boolean).forEach((input) => {
      input.addEventListener("input", () => { state.newDraft = input.value; persist(); resizeTextarea(input); updateSubmitState(); });
      input.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          newPrompt ? createAndRun() : sendPrompt();
        }
      });
    });

    const workspace = document.getElementById("new-workspace");
    const provider = document.getElementById("new-provider");
    const permission = document.getElementById("new-permission");
    const model = document.getElementById("new-model");
    const worktree = document.getElementById("new-worktree");
    const autoCommit = document.getElementById("auto-commit");
    if (workspace) workspace.addEventListener("change", () => { state.newWorkspace = workspace.value; persist(); });
    if (provider) provider.addEventListener("change", () => { state.newProvider = provider.value; state.newModel = state.snapshot.config.defaultModels[provider.value] || ""; persist(); render({ preserveFocus: true }); });
    if (permission) permission.addEventListener("change", () => { state.newPermission = permission.value; if (permission.value === "plan" || permission.value === "read-only") state.autoCommit = false; persist(); render({ preserveFocus: true }); });
    if (model) model.addEventListener("input", () => { state.newModel = model.value; persist(); });
    if (worktree) worktree.addEventListener("change", () => { state.newWorktree = worktree.checked; persist(); render({ preserveFocus: true }); });
    if (autoCommit) autoCommit.addEventListener("change", () => { state.autoCommit = autoCommit.checked; persist(); });

    const sessionTitle = document.getElementById("session-title");
    if (sessionTitle) sessionTitle.addEventListener("change", () => { const session = activeSession(); if (session) post("updateSession", { sessionId: session.id, title: sessionTitle.value, model: session.model, permission: session.permission }); });
    const agentSearch = document.getElementById("agent-search");
    if (agentSearch) agentSearch.addEventListener("input", () => { state.sessionQuery = agentSearch.value; persist(); render({ preserveFocus: true }); });
    const fileSearch = document.getElementById("file-search");
    if (fileSearch) fileSearch.addEventListener("input", () => { state.fileQuery = fileSearch.value; render({ preserveFocus: true }); });
    app.querySelectorAll("[data-resize]").forEach((handle) => handle.addEventListener("pointerdown", beginResize));
  }

  function updateSubmitState() {
    const button = document.querySelector(".new-session-card .submit-arrow");
    if (button) button.classList.toggle("disabled", !state.newDraft.trim() || state.startingSession);
  }

  function beginResize(event) {
    const side = event.currentTarget.dataset.resize;
    const startX = event.clientX;
    const startWidth = side === "left" ? state.leftWidth : state.rightWidth;
    document.body.classList.add("resizing");
    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") state.leftWidth = clamp(startWidth + delta, 240, 520);
      else state.rightWidth = clamp(startWidth - delta, 280, 580);
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
    const region = document.getElementById("toast-region");
    if (!region) return;
    region.innerHTML = '<div class="toast ' + attr(level || "info") + '">' + escapeHtml(message) + "</div>";
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { if (region) region.innerHTML = ""; }, 4500);
  }

  function updateSessionLocal(session) {
    const index = state.snapshot.sessions.findIndex((item) => item.id === session.id);
    if (index === -1) state.snapshot.sessions.unshift(session);
    else state.snapshot.sessions[index] = session;
  }

  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "snapshot") {
      const previousWorkspace = state.snapshot && state.snapshot.selectedWorktreePath;
      state.snapshot = message.snapshot;
      state.newProvider = state.newProvider || state.snapshot.config.defaultProvider;
      state.newPermission = state.newPermission || state.snapshot.config.defaultPermission;
      state.newWorkspace = state.newWorkspace || state.snapshot.selectedWorktreePath || state.snapshot.workspaces[0]?.path || "";
      if (previousWorkspace !== state.snapshot.selectedWorktreePath) {
        state.directories = new Map([["", state.snapshot.files || []]]);
        state.expandedDirectories = new Set([""]);
      } else {
        state.directories.set("", state.snapshot.files || []);
      }
      if (state.startingSession) {
        state.startingSession = false;
        state.newDraft = "";
        state.editorContext = null;
        state.view = "chat";
      }
      if (state.view === "chat" && !activeSession()) state.view = state.snapshot.worktrees.length ? "worktree" : "new";
      persist();
      render();
    } else if (message.type === "health" && state.snapshot) {
      state.snapshot.health = message.health;
      render({ preserveFocus: true });
    } else if (message.type === "session" && state.snapshot) {
      updateSessionLocal(message.session);
      state.snapshot.activeSessionId = message.session.id;
      render({ preserveFocus: true });
    } else if (message.type === "sessionMeta" && state.snapshot) {
      const session = state.snapshot.sessions.find((item) => item.id === message.sessionId);
      if (session) Object.assign(session, message.patch);
      render({ preserveFocus: true });
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
      render({ preserveFocus: true });
    } else if (message.type === "changes" && state.snapshot) {
      state.snapshot.changes = message.changes || [];
      state.snapshot.branch = message.branch || "";
      render({ preserveFocus: true });
    } else if (message.type === "files" && state.snapshot) {
      state.snapshot.files = message.files || [];
      state.snapshot.fileWorkspace = message.workspace;
      state.directories.set("", state.snapshot.files);
      render({ preserveFocus: true });
    } else if (message.type === "directory") {
      state.directories.set(message.path || "", message.entries || []);
      render({ preserveFocus: true });
    } else if (message.type === "commitFiles") {
      state.commitFiles.set(message.hash, message.files || []);
      render({ preserveFocus: true });
    } else if (message.type === "editorContext") {
      state.editorContext = message.context;
      render({ preserveFocus: true });
    } else if (message.type === "workspacePicked") {
      state.newWorkspace = message.workspace;
      persist();
      render();
    } else if (message.type === "showNewSession") {
      openNew(true);
    } else if (message.type === "nativeSessions") {
      state.nativeSessions = message.sessions || [];
      state.importLoading = false;
      state.modal = "import";
      render();
    } else if (message.type === "notification") {
      state.startingSession = false;
      render({ preserveFocus: true });
      showToast(message.message, message.level);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modal) closeModal();
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      if (state.snapshot) openNew(true);
    }
  });

  post("ready");
})();
