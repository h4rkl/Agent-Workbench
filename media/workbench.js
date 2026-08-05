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
    newBaseBranch: saved.newBaseBranch || "",
    newBranchName: saved.newBranchName || "",
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
      newBaseBranch: state.newBaseBranch,
      newBranchName: state.newBranchName,
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
    const names = {
      agent: "robot",
      add: "add",
      search: "search",
      tune: "filter",
      chat: "comment-discussion",
      branch: "git-branch",
      history: "history",
      changes: "source-control",
      folder: "folder",
      file: "file",
      chevron: "chevron-right",
      settings: "settings-gear",
      output: "output",
      import: "cloud-download",
      send: "arrow-up",
      stop: "debug-stop",
      refresh: "refresh",
      window: "multiple-windows",
      attach: "attach",
      more: "ellipsis",
      close: "close",
      copy: "copy",
      archive: "archive",
      trash: "trash",
      commit: "git-commit",
      check: "check"
    };
    return codicon(names[name] || "file", label || name, "icon");
  }

  function codicon(name, label, className) {
    return '<span class="codicon codicon-' + attr(name) + (className ? " " + attr(className) : "") + '" aria-hidden="true"></span>' + (label ? '<span class="sr-only">' + escapeHtml(label) + "</span>" : "");
  }

  function fileIcon(path, type, expanded) {
    if (type === "directory") {
      return codicon(expanded ? "folder-opened" : "folder", "Folder", "icon file-icon");
    }
    const extension = String(path || "").toLowerCase().split(".").pop();
    let name = "file";
    if (extension === "json" || extension === "jsonc") name = "json";
    else if (extension === "md" || extension === "mdx") name = "markdown";
    else if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "mp3", "wav", "mp4", "mov"].includes(extension)) name = "file-media";
    else if (["zip", "gz", "tgz", "tar", "7z", "rar"].includes(extension)) name = "file-zip";
    else if (["pdf", "woff", "woff2", "ttf", "otf", "bin", "wasm"].includes(extension)) name = "file-binary";
    else if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "less", "html", "vue", "svelte", "py", "rb", "go", "rs", "java", "kt", "c", "cc", "cpp", "h", "hpp", "sh", "zsh", "fish", "yml", "yaml", "toml", "xml", "sql"].includes(extension)) name = "file-code";
    return codicon(name, "File", "icon file-icon");
  }

  function changePresentation(change) {
    const status = String(change.status || "M").toUpperCase();
    if (change.untracked || status.includes("?")) return { kind: "untracked", icon: "diff-added", label: "Untracked" };
    if (status.includes("U")) return { kind: "conflict", icon: "warning", label: "Merge conflict" };
    if (status.includes("D")) return { kind: "deleted", icon: "diff-removed", label: "Deleted" };
    if (status.includes("R") || status.includes("C")) return { kind: "renamed", icon: "diff-renamed", label: status.includes("R") ? "Renamed" : "Copied" };
    if (status.includes("A")) return { kind: "added", icon: "diff-added", label: "Added" };
    return { kind: "modified", icon: "diff-modified", label: "Modified" };
  }

  function changeIcon(change) {
    const presentation = changePresentation(change);
    return '<span class="change-icon ' + presentation.kind + '" title="' + attr(presentation.label) + '">' + codicon(presentation.icon, presentation.label) + "</span>";
  }

  function providerName(provider) {
    return provider === "codex" ? "Codex" : "Claude";
  }

  function providerLogo(provider) {
    return '<span class="provider-logo ' + attr(provider) + '" aria-hidden="true"><span class="codicon codicon-' + (provider === "codex" ? "sparkle-filled" : "hubot") + '"></span></span>';
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

  function defaultBaseBranch(currentWorktree) {
    const branches = state.snapshot.branches || [];
    if (state.newBaseBranch && branches.includes(state.newBaseBranch)) return state.newBaseBranch;
    if (branches.includes("main")) return "main";
    if (currentWorktree && branches.includes(currentWorktree.branch)) return currentWorktree.branch;
    if (branches.includes(state.snapshot.branch)) return state.snapshot.branch;
    return branches[0] || state.snapshot.branch || "main";
  }

  function baseBranchOptions(current) {
    const branches = [...(state.snapshot.branches || [])];
    if (current && !branches.includes(current)) branches.unshift(current);
    return branches.map((branch) => '<option value="' + attr(branch) + '" ' + selected(current, branch) + '>' + escapeHtml(branch) + "</option>").join("");
  }

  function newSessionView() {
    const currentWorktree = selectedWorktree();
    const workspace = state.newWorkspace || (currentWorktree && currentWorktree.path) || state.snapshot.workspaces[0]?.path || "";
    const provider = state.newProvider || state.snapshot.config.defaultProvider;
    const permission = state.newPermission || state.snapshot.config.defaultPermission;
    const canCommit = permission === "workspace-write" || permission === "full-access";
    const health = state.snapshot.health[provider];
    const baseBranch = defaultBaseBranch(currentWorktree);
    const branchSetup = state.newWorktree
      ? '<div class="branch-setup"><span class="branch-setup-title">' + codicon("git-branch-create", "Create branch", "icon") + '<strong>New branch</strong></span><label><span>From</span><span class="branch-select"><select id="new-base-branch">' + baseBranchOptions(baseBranch) + '</select>' + icon("chevron") + '</span></label><label class="branch-name-input"><span>Name</span><input id="new-branch-name" value="' + attr(state.newBranchName) + '" placeholder="codex/fix-breakpoint-default-locale" spellcheck="false"></label></div>'
      : "";
    return '<main class="center-pane new-session-view"><div class="corner-agent">' + icon("agent") + '</div><section class="new-session-card"><div class="new-session-title">New agent in <label class="inline-select folder-select">' + icon("folder") + '<select id="new-workspace">' + workspaceOptions(workspace) + '</select>' + icon("chevron") + '</label> with <label class="inline-select provider-select">' + providerLogo(provider) + '<select id="new-provider"><option value="codex" ' + selected(provider, "codex") + '>Codex</option><option value="claude" ' + selected(provider, "claude") + '>Claude</option></select>' + icon("chevron") + "</label></div>" +
      '<div class="prompt-shell"><div class="tip-line"><strong>Tip:</strong> Select code in an editor, then use <span class="tip-icon"><span class="codicon codicon-add" aria-hidden="true"></span></span> to attach it as precise feedback context.</div><div class="new-composer">' + contextChip() + '<textarea id="new-prompt" rows="3" placeholder="What will this agent complete?">' + escapeHtml(state.newDraft) + '</textarea><div class="new-composer-footer"><div class="composer-tools"><button class="composer-icon" data-action="captureEditorSelection" title="Attach the current editor selection">' + icon("add") + '</button><span class="composer-mode">' + icon("agent") + 'Agent</span><label class="composer-mode model-control"><span class="codicon codicon-sparkle" aria-hidden="true"></span><input id="new-model" value="' + attr(state.newModel || state.snapshot.config.defaultModels[provider] || "") + '" placeholder="Auto" title="Optional model"></label></div><button class="submit-arrow ' + (!state.newDraft.trim() || state.startingSession || !health.available ? "disabled" : "") + '" data-action="createAndRun" title="' + attr(health.available ? "Start agent" : providerName(provider) + " CLI is unavailable") + '">' + (state.startingSession ? '<span class="run-spinner"></span>' : icon("send")) + "</button></div></div></div>" +
      '<div class="new-meta"><div><span class="meta-control">' + icon("chat") + 'Interactive</span><label class="meta-control">' + icon("check") + '<select id="new-permission"><option value="plan" ' + selected(permission, "plan") + '>Plan only</option><option value="read-only" ' + selected(permission, "read-only") + '>Read only</option><option value="workspace-write" ' + selected(permission, "workspace-write") + '>Default permissions</option><option value="full-access" ' + selected(permission, "full-access") + '>Full access</option></select></label></div><div><label class="worktree-toggle ' + (!canCommit ? "disabled" : "") + '"><input id="auto-commit" type="checkbox" ' + (state.autoCommit && canCommit ? "checked" : "") + (!canCommit ? " disabled" : "") + '><span>' + icon("check") + '</span> Commit result</label><label class="worktree-toggle"><input id="new-worktree" type="checkbox" ' + (state.newWorktree ? "checked" : "") + '><span>' + icon("check") + '</span> New Worktree</label><span class="meta-control branch-name">' + icon("branch") + escapeHtml(state.snapshot.branch || currentWorktree?.branch || "main") + "</span></div></div>" +
      branchSetup + '<p class="new-session-note">' + (state.newWorktree ? "The branch will start from " + escapeHtml(baseBranch) + "; leave its name blank to generate an agent/<task>-<timestamp> name." : "The agent will work directly in the selected worktree.") + "</p></section></main>";
  }

  function messageCard(message, session) {
    const roleName = ({ user: "You", assistant: providerName(session.provider), reasoning: "Reasoning", tool: message.title || "Tool", system: "System", error: message.title || "Error" })[message.role] || message.role;
    const body = '<div class="message-body" data-message-id="' + attr(message.id) + '">' + formatMessage(message.content) + (message.state === "running" && message.role === "assistant" ? '<span class="stream-cursor"></span>' : "") + "</div>";
    if (message.role === "tool" || message.role === "reasoning") {
      return '<details class="message-card compact-card" ' + (message.state === "running" ? "open" : "") + '><summary><span class="tool-state ' + attr(message.state || "completed") + '"></span><span>' + escapeHtml(roleName) + '</span><span class="summary-spacer"></span><span class="message-time">' + timeAgo(message.createdAt) + "</span></summary>" + body + "</details>";
    }
    return '<article class="message-card ' + attr(message.role) + '"><header><span class="message-author">' + (message.role === "assistant" ? providerLogo(session.provider) : '<span class="role-icon"><span class="codicon codicon-' + (message.role === "user" ? "account" : "error") + '" aria-hidden="true"></span></span>') + '<strong>' + escapeHtml(roleName) + '</strong></span><span class="message-time">' + timeAgo(message.createdAt) + "</span></header>" + body + "</article>";
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
      ? state.snapshot.changes.slice(0, 8).map((change) => `<button data-action="openDiff" data-path="${attr(change.path)}">${fileIcon(change.path)}<span class="change-path">${escapeHtml(change.path)}</span>${changeIcon(change)}</button>`).join("")
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
      return '<div class="file-node"><button class="file-row ' + (isDirectory ? "directory" : "") + '" style="--depth:' + depth + '" data-action="' + (isDirectory ? "toggleDirectory" : "openFile") + '" data-path="' + attr(entry.path) + '" title="' + attr(entry.path) + '"><span class="tree-chevron">' + (isDirectory ? icon("chevron") : "") + '</span>' + fileIcon(entry.path, entry.type, expanded) + '<span class="file-name">' + escapeHtml(entry.name) + "</span></button>" + childMarkup + "</div>";
    }).join("");
  }

  function changesPanel() {
    const changes = state.snapshot.changes || [];
    return '<div class="right-content changes-content">' + (changes.length ? changes.map((change) => '<div class="change-row"><button data-action="openDiff" data-path="' + attr(change.path) + '">' + fileIcon(change.path) + '<span class="change-path">' + escapeHtml(change.path) + '</span>' + changeIcon(change) + '</button><button class="icon-button" data-action="openFile" data-path="' + attr(change.path) + '" title="Open file">' + codicon("go-to-file", "Open file", "icon") + "</button></div>").join("") : '<div class="right-empty">' + icon("check") + '<strong>Worktree clean</strong><span>No uncommitted files detected</span></div>') + "</div>";
  }

  function filesPanel() {
    const workspace = state.snapshot.fileWorkspace;
    return '<div class="right-content files-content">' + (state.fileSearchOpen ? '<label class="file-search">' + icon("search") + '<input id="file-search" value="' + attr(state.fileQuery) + '" placeholder="Filter loaded files"></label>' : "") + (workspace ? '<button class="root-row" data-action="toggleRoot">' + icon("chevron") + '<strong>' + escapeHtml(workspace.name) + '</strong><small>' + escapeHtml(state.snapshot.branch || "") + "</small></button>" + (state.expandedDirectories.has("") ? '<div class="file-tree">' + fileRows(state.directories.get("") || state.snapshot.files || [], 0) + "</div>" : "") : '<div class="right-empty">Open a workspace to browse files.</div>') + "</div>";
  }

  function commitPanel() {
    const commit = state.snapshot.commits.find((item) => item.hash === state.selectedCommit);
    const files = state.commitFiles.get(state.selectedCommit) || [];
    if (!commit) return '<div class="right-empty">Select a commit from history.</div>';
    return '<div class="right-content commit-content"><div class="commit-summary"><code>' + escapeHtml(commit.hash.slice(0, 10)) + '</code><h3>' + escapeHtml(commit.subject) + '</h3><p>' + escapeHtml(commit.author) + " · " + new Date(commit.date).toLocaleString() + "</p>" + commit.refs.map((ref) => '<span class="ref-label">' + escapeHtml(ref) + "</span>").join("") + '</div><div class="commit-files"><div class="section-label">Changed files <span>' + files.length + "</span></div>" + (files.length ? files.map((file) => '<div class="commit-file-row"><button data-action="openCommitFile" data-hash="' + attr(commit.hash) + '" data-path="' + attr(file.path) + '" data-status="' + attr(file.status) + '" title="Open commit diff">' + fileIcon(file.path) + '<span class="change-path">' + escapeHtml(file.path) + '</span><small><b>+' + file.additions + "</b> <i>-" + file.deletions + "</i></small>" + changeIcon(file) + '</button>' + (!String(file.status || "").includes("D") ? '<button class="icon-button" data-action="openFile" data-path="' + attr(file.path) + '" title="Open file in selected worktree">' + codicon("go-to-file", "Open working file", "icon") + "</button>" : "") + "</div>").join("") : '<div class="sidebar-empty">Loading commit files…</div>') + "</div></div>";
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
      newWorktree: state.newWorktree,
      baseBranch: state.newWorktree ? defaultBaseBranch(selectedWorktree()) : "",
      branchName: state.newWorktree ? state.newBranchName.trim() : ""
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
        else if (action === "openCommitFile") post("openCommitFile", { hash: button.dataset.hash, path: button.dataset.path, status: button.dataset.status });
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
    const baseBranch = document.getElementById("new-base-branch");
    const branchName = document.getElementById("new-branch-name");
    if (workspace) workspace.addEventListener("change", () => { state.newWorkspace = workspace.value; persist(); });
    if (provider) provider.addEventListener("change", () => { state.newProvider = provider.value; state.newModel = state.snapshot.config.defaultModels[provider.value] || ""; persist(); render({ preserveFocus: true }); });
    if (permission) permission.addEventListener("change", () => { state.newPermission = permission.value; if (permission.value === "plan" || permission.value === "read-only") state.autoCommit = false; persist(); render({ preserveFocus: true }); });
    if (model) model.addEventListener("input", () => { state.newModel = model.value; persist(); });
    if (worktree) worktree.addEventListener("change", () => { state.newWorktree = worktree.checked; persist(); render({ preserveFocus: true }); });
    if (autoCommit) autoCommit.addEventListener("change", () => { state.autoCommit = autoCommit.checked; persist(); });
    if (baseBranch) baseBranch.addEventListener("change", () => { state.newBaseBranch = baseBranch.value; persist(); render({ preserveFocus: true }); });
    if (branchName) branchName.addEventListener("input", () => { state.newBranchName = branchName.value; persist(); });

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
        state.newBranchName = "";
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
