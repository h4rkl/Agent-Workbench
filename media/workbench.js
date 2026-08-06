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
    newBranch: typeof saved.newBranch === "boolean" ? saved.newBranch : saved.newWorktree !== false,
    newBaseBranch: saved.newBaseBranch || "",
    newWorkspaceBranch: saved.newWorkspaceBranch || "",
    newBranchName: saved.newBranchName || "",
    autoCommit: saved.autoCommit !== false,
    sessionQuery: saved.sessionQuery || "",
    sessionFilter: saved.sessionFilter || "active",
    modal: null,
    menuSessionId: null,
    worktreeMenu: null,
    nativeSessions: [],
    importLoading: false,
    startingSession: false,
    editorContext: null,
    attachments: [],
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
      newBranch: state.newBranch,
      newBaseBranch: state.newBaseBranch,
      newWorkspaceBranch: state.newWorkspaceBranch,
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
      check: "check",
      reveal: "folder-opened",
      warning: "warning"
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
    return provider === "codex" ? "Codex" : provider === "grok" ? "Grok" : "Claude";
  }

  function providerLogo(provider) {
    const logo = provider === "codex" ? "sparkle-filled" : provider === "grok" ? "rocket" : "hubot";
    return '<span class="provider-logo ' + attr(provider) + '" aria-hidden="true"><span class="codicon codicon-' + logo + '"></span></span>';
  }

  function permissionName(permission) {
    return ({ plan: "Plan", "read-only": "Read only", "workspace-write": "Default permissions", "full-access": "Unrestricted" })[permission] || permission;
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
      '<div class="left-scroll"><section class="nav-section"><button class="nav-row ' + (state.view === "new" ? "active" : "") + '" data-action="openNew" data-worktree="true">' + icon("add") + '<span>New task</span></button><button class="nav-row ' + (state.view === "history" ? "active" : "") + '" data-action="showHistory">' + icon("history") + '<span>Repository history</span><span class="nav-count">' + state.snapshot.commits.length + "</span></button></section>" +
      '<section class="worktree-section"><div class="section-label">Repository worktrees <span>' + worktrees.length + '</span></div><div class="worktree-list">' + (worktrees.length ? worktrees.map(worktreeRow).join("") : '<div class="sidebar-empty">Open a Git repository to manage worktrees.</div>') + "</div></section>" +
      '<section class="agents-section"><div class="section-label">Agents on selected worktree <span>' + agents.length + '</span></div><label class="agent-search ' + (state.sessionQuery ? "visible" : "") + '">' + icon("search") + '<input id="agent-search" value="' + attr(state.sessionQuery) + '" placeholder="Filter agents"></label><div class="agent-list">' + (agents.filter((session) => !state.sessionQuery || session.title.toLowerCase().includes(state.sessionQuery.toLowerCase())).map(agentRow).join("") || '<div class="sidebar-empty compact">No agents on this worktree.</div>') + "</div></section></div>" +
      '<footer class="left-footer"><div class="section-label">Tools</div><button class="nav-row" data-action="import">' + icon("import") + '<span>Import agent history</span></button><button class="nav-row" data-action="settings">' + icon("settings") + '<span>Agent settings</span></button><button class="nav-row" data-action="output">' + icon("output") + '<span>Agent output</span></button></footer></aside>';
  }

  function contextChip() {
    if (!state.editorContext) return "";
    const context = state.editorContext;
    return '<div class="context-chip" title="' + attr(context.path) + '">' + icon("file") + '<span>' + escapeHtml(basename(context.path)) + ":" + context.startLine + (context.endLine !== context.startLine ? "–" + context.endLine : "") + '</span><button data-action="clearContext" title="Remove context">' + icon("close") + "</button></div>";
  }

  const MAX_ATTACHMENT_COUNT = 10;
  const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
  const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

  function formatBytes(value) {
    const size = Number(value) || 0;
    if (size < 1024) return size ? size + " B" : "";
    if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
    return (size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  }

  function attachmentMarkup(attachments, removable) {
    if (!attachments || !attachments.length) return "";
    return '<div class="attachment-list" aria-label="Attached files">' + attachments.map((attachment) => {
      const image = String(attachment.mimeType || "").startsWith("image/");
      const size = formatBytes(attachment.size);
      return '<span class="attachment-chip" title="' + attr(attachment.name) + '">' + codicon(image ? "file-media" : "file", image ? "Image" : "File", "icon") + '<span>' + escapeHtml(attachment.name) + '</span>' + (size ? '<small>' + escapeHtml(size) + '</small>' : "") + (removable ? '<button data-action="removeAttachment" data-attachment-id="' + attr(attachment.id) + '" title="Remove attachment">' + icon("close") + "</button>" : "") + "</span>";
    }).join("") + "</div>";
  }

  function composerAttachments() {
    return attachmentMarkup(state.attachments, true);
  }

  function messageAttachments(message) {
    const attachments = message && message.metadata && Array.isArray(message.metadata.attachments)
      ? message.metadata.attachments
      : [];
    return attachmentMarkup(attachments, false);
  }

  function hasComposerInput() {
    return Boolean(state.newDraft.trim() || state.attachments.length);
  }

  function attachmentPrompt() {
    return state.newDraft.trim() || "Please review the attached file or image.";
  }

  function attachmentId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function filenameFromUri(uri) {
    try {
      const url = new URL(uri);
      return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "attachment");
    } catch {
      return "attachment";
    }
  }

  function inferMimeType(name, provided) {
    if (provided) return provided;
    const extension = String(name || "").toLowerCase().split(".").pop();
    const images = { avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp" };
    return images[extension] || "application/octet-stream";
  }

  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const parts = [];
    const chunkSize = 32 * 1024;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      parts.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }
    return btoa(parts.join(""));
  }

  async function attachmentFromFile(file) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(file.name + " exceeds the 20 MB limit.");
    }
    const common = {
      id: attachmentId(),
      name: file.name || "attachment",
      mimeType: inferMimeType(file.name, file.type),
      size: file.size || 0
    };
    if (typeof file.path === "string" && file.path) {
      return Object.assign(common, { sourcePath: file.path });
    }
    return Object.assign(common, { data: bufferToBase64(await file.arrayBuffer()) });
  }

  function uriAttachments(value) {
    return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => {
      if (!line || line.startsWith("#")) return false;
      try { return new URL(line).protocol === "file:"; } catch { return false; }
    }).map((uri) => {
      const name = filenameFromUri(uri);
      return {
        id: attachmentId(),
        name,
        mimeType: inferMimeType(name, ""),
        size: 0,
        uri
      };
    });
  }

  function addAttachments(items) {
    const existing = new Set(state.attachments.map((item) => item.uri || item.sourcePath || item.name + ":" + item.size));
    const additions = items.filter((item) => {
      const key = item.uri || item.sourcePath || item.name + ":" + item.size;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    if (state.attachments.length + additions.length > MAX_ATTACHMENT_COUNT) {
      showToast("Attach at most 10 files at a time.", "error");
      return;
    }
    const total = [...state.attachments, ...additions].reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      showToast("Attachments exceed the 50 MB total limit.", "error");
      return;
    }
    if (!additions.length) return;
    state.attachments.push(...additions);
    render({ preserveFocus: true });
  }

  function transferContainsFiles(transfer) {
    if (!transfer) return false;
    const types = Array.from(transfer.types || []);
    return Boolean(transfer.files && transfer.files.length) || types.includes("Files") || types.includes("text/uri-list");
  }

  async function handleAttachmentDrop(transfer) {
    const uris = uriAttachments(transfer.getData("text/uri-list"));
    if (uris.length) {
      addAttachments(uris);
      return;
    }
    const results = await Promise.allSettled(Array.from(transfer.files || []).map(attachmentFromFile));
    const items = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const failure = results.find((result) => result.status === "rejected");
    if (items.length) addAttachments(items);
    if (failure) showToast(failure.reason instanceof Error ? failure.reason.message : "A dropped file could not be attached.", "error");
  }

  function workspaceOptions(current) {
    const entries = new Map();
    (state.snapshot.worktrees || []).forEach((item) => entries.set(item.path, { path: item.path, name: item.branch }));
    (state.snapshot.workspaces || []).forEach((item) => { if (!entries.has(item.path)) entries.set(item.path, item); });
    if (current && !entries.has(current)) entries.set(current, { path: current, name: basename(current) });
    return [...entries.values()].map((workspace) => '<option value="' + attr(workspace.path) + '" ' + selected(current, workspace.path) + '>' + escapeHtml(workspace.name || basename(workspace.path)) + "</option>").join("");
  }

  function worktreeTargetOptions(current) {
    const entries = new Map();
    (state.snapshot.worktrees || []).forEach((item) => entries.set(item.path, { path: item.path, name: item.branch }));
    (state.snapshot.workspaces || []).forEach((item) => { if (!entries.has(item.path)) entries.set(item.path, item); });
    if (current && !entries.has(current)) entries.set(current, { path: current, name: basename(current) });
    return '<option value="__new__" ' + (state.newWorktree ? "selected" : "") + '>New worktree</option>' + [...entries.values()].map((workspace) => '<option value="' + attr(workspace.path) + '" ' + (!state.newWorktree ? selected(current, workspace.path) : "") + '>Existing · ' + escapeHtml(workspace.name || basename(workspace.path)) + "</option>").join("");
  }

  function defaultBaseBranch(currentWorktree) {
    const branches = state.snapshot.branches || [];
    if (state.newBaseBranch && branches.includes(state.newBaseBranch)) return state.newBaseBranch;
    if (currentWorktree && branches.includes(currentWorktree.branch)) return currentWorktree.branch;
    if (branches.includes(state.snapshot.branch)) return state.snapshot.branch;
    if (branches.includes("main")) return "main";
    return branches[0] || state.snapshot.branch || "main";
  }

  function syncSelectedBranch(nextBranch) {
    if (!nextBranch || !state.snapshot) return;
    const current = selectedWorktree();
    const previousBranch = current?.branch || state.snapshot.branch || "";
    state.snapshot.branch = nextBranch;
    if (current) {
      current.branch = nextBranch;
      current.detached = nextBranch === "detached";
    }
    if (nextBranch !== "detached" && !state.snapshot.branches.includes(nextBranch)) {
      state.snapshot.branches.push(nextBranch);
      state.snapshot.branches.sort((a, b) => a.localeCompare(b));
    }
    if (state.newWorkspace === current?.path && (!state.newBaseBranch || state.newBaseBranch === previousBranch)) {
      state.newBaseBranch = nextBranch === "detached" ? "" : nextBranch;
    }
    if (state.newWorkspace === current?.path) state.newWorkspaceBranch = nextBranch;
  }

  function baseBranchOptions(current) {
    const branches = [...(state.snapshot.branches || [])];
    if (current && !branches.includes(current)) branches.unshift(current);
    return branches.map((branch) => '<option value="' + attr(branch) + '" ' + selected(current, branch) + '>' + escapeHtml(branch) + "</option>").join("");
  }

  function branchTargetOptions(currentWorktree, baseBranch) {
    const options = ['<option value="__new__" ' + (state.newBranch ? "selected" : "") + '>New branch</option>'];
    if (!state.newWorktree) {
      const branch = currentWorktree?.branch || state.snapshot.branch || baseBranch;
      options.push('<option value="' + attr(branch) + '" ' + (!state.newBranch ? "selected" : "") + '>Current · ' + escapeHtml(branch) + "</option>");
      return options.join("");
    }
    const checkedOut = new Set((state.snapshot.worktrees || []).map((worktree) => worktree.branch));
    for (const branch of state.snapshot.branches || []) {
      const unavailable = checkedOut.has(branch);
      options.push('<option value="' + attr(branch) + '" ' + (!state.newBranch ? selected(baseBranch, branch) : "") + (unavailable ? " disabled" : "") + '>Existing · ' + escapeHtml(branch) + (unavailable ? " (already in a worktree)" : "") + "</option>");
    }
    return options.join("");
  }

  function newSessionView() {
    const selectedTree = selectedWorktree();
    const workspace = state.newWorkspace || (selectedTree && selectedTree.path) || state.snapshot.workspaces[0]?.path || "";
    const currentWorktree = state.snapshot.worktrees.find((worktree) => worktree.path === workspace) || selectedTree;
    const provider = state.newProvider || state.snapshot.config.defaultProvider;
    const permission = state.newPermission || state.snapshot.config.defaultPermission;
    const canCommit = permission === "workspace-write" || permission === "full-access";
    const health = state.snapshot.health[provider];
    const baseBranch = defaultBaseBranch(currentWorktree);
    const branchFields = state.newBranch
      ? '<label><span>From</span><span class="branch-select"><select id="new-base-branch">' + baseBranchOptions(baseBranch) + '</select>' + icon("chevron") + '</span></label><label class="branch-name-input"><span>Name</span><input id="new-branch-name" value="' + attr(state.newBranchName) + '" placeholder="Optional · agent/task-name" spellcheck="false"></label>'
      : "";
    const summary = state.newWorktree
      ? state.newBranch ? "Creates a new worktree and branch from " + baseBranch + "." : "Creates a new worktree on the existing " + baseBranch + " branch."
      : state.newBranch ? "Creates and checks out a new branch from " + baseBranch + " here." : "Starts on the current " + (currentWorktree?.branch || state.snapshot.branch || "branch") + " branch.";
    const repositoryField = state.newWorktree ? '<label><span>Repository</span><span class="branch-select repository-select"><select id="new-workspace">' + workspaceOptions(workspace) + '</select>' + icon("chevron") + "</span></label>" : "";
    const branchSetup = '<div class="branch-setup"><span class="branch-setup-title">' + codicon("git-branch", "Branch", "icon") + '<strong>Start</strong></span>' + repositoryField + '<label class="branch-target"><span>Branch</span><span class="branch-select"><select id="new-branch-target">' + branchTargetOptions(currentWorktree, baseBranch) + '</select>' + icon("chevron") + '</span></label>' + branchFields + '</div><p class="new-session-note">' + escapeHtml(summary) + (state.newBranch ? " Leave the name blank to generate one from the task." : "") + "</p>";
    return '<main class="center-pane new-session-view"><div class="corner-agent">' + icon("agent") + '</div><section class="new-session-card"><div class="new-session-title">New <label class="inline-select provider-select">' + providerLogo(provider) + '<select id="new-provider"><option value="codex" ' + selected(provider, "codex") + '>Codex agent</option><option value="claude" ' + selected(provider, "claude") + '>Claude agent</option><option value="grok" ' + selected(provider, "grok") + '>Grok agent</option></select>' + icon("chevron") + '</label> in <label class="inline-select folder-select">' + icon("folder") + '<select id="new-worktree-target">' + worktreeTargetOptions(workspace) + '</select>' + icon("chevron") + "</label></div>" +
      '<div class="prompt-shell"><div class="tip-line"><strong>Tip:</strong> Drag files or images into the prompt, or select code in an editor and use <span class="tip-icon"><span class="codicon codicon-add" aria-hidden="true"></span></span> for precise context.</div><div class="new-composer composer-drop-target" data-file-drop="true">' + contextChip() + composerAttachments() + '<textarea id="new-prompt" rows="3" placeholder="What will this agent complete?">' + escapeHtml(state.newDraft) + '</textarea><div class="new-composer-footer"><div class="composer-tools"><button class="composer-icon" data-action="captureEditorSelection" title="Attach the current editor selection">' + icon("add") + '</button><span class="composer-mode">' + icon("agent") + 'Agent</span><label class="composer-mode model-control"><span class="codicon codicon-sparkle" aria-hidden="true"></span><input id="new-model" value="' + attr(state.newModel || state.snapshot.config.defaultModels[provider] || "") + '" placeholder="Auto" title="Optional model"></label></div><button class="submit-arrow ' + (!hasComposerInput() || state.startingSession || !health.available ? "disabled" : "") + '" data-action="createAndRun" title="' + attr(health.available ? "Start agent" : providerName(provider) + " CLI is unavailable") + '">' + (state.startingSession ? '<span class="run-spinner"></span>' : icon("send")) + "</button></div></div></div>" +
      '<div class="new-meta"><div><span class="meta-control">' + icon("chat") + 'Interactive</span><label class="meta-control">' + icon("check") + '<select id="new-permission"><option value="plan" ' + selected(permission, "plan") + '>Plan only</option><option value="read-only" ' + selected(permission, "read-only") + '>Read only</option><option value="workspace-write" ' + selected(permission, "workspace-write") + '>Default permissions</option><option value="full-access" ' + selected(permission, "full-access") + '>Unrestricted</option></select></label><label class="worktree-toggle unrestricted-toggle" title="Bypass provider approvals and sandbox restrictions"><input id="unrestricted-access" type="checkbox" role="switch" ' + (permission === "full-access" ? "checked" : "") + '><span>' + icon("warning") + '</span><b>Unrestricted</b></label></div><div><label class="worktree-toggle ' + (!canCommit ? "disabled" : "") + '"><input id="auto-commit" type="checkbox" ' + (state.autoCommit && canCommit ? "checked" : "") + (!canCommit ? " disabled" : "") + '><span>' + icon("check") + '</span> Commit result</label></div></div>' +
      branchSetup + '</section></main>';
  }

  function messageCard(message, session) {
    const roleName = ({ user: "You", assistant: providerName(session.provider), reasoning: "Reasoning", tool: message.title || "Tool", system: "System", error: message.title || "Error" })[message.role] || message.role;
    const body = '<div class="message-body" data-message-id="' + attr(message.id) + '">' + formatMessage(message.content) + messageAttachments(message) + (message.state === "running" && message.role === "assistant" ? '<span class="stream-cursor"></span>' : "") + "</div>";
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
      : '<button class="submit-arrow ' + (!hasComposerInput() ? "disabled" : "") + '" data-action="sendPrompt">' + icon("send") + "</button>";
    return '<main class="center-pane conversation-view">' +
      '<header class="conversation-header"><div><span class="eyebrow">' + escapeHtml(basename(session.workspace)) + " · " + escapeHtml(session.provider) + '</span><input id="session-title" value="' + attr(session.title) + '" aria-label="Agent title"></div>' +
      '<div class="header-actions"><button class="secondary-button" data-action="openWorktree" data-path="' + attr(session.workspace) + '">' + icon("window") + 'Open worktree</button><button class="icon-button" data-action="sessionMenu" data-session-id="' + attr(session.id) + '">' + icon("more") + "</button></div></header>" +
      '<div id="message-list" class="message-list">' + messages + "</div>" +
      '<div class="conversation-composer-wrap"><div class="conversation-composer composer-drop-target" data-file-drop="true">' + contextChip() + composerAttachments() + '<textarea id="prompt-input" rows="1" placeholder="Give feedback or assign the next step…" ' + (running ? "disabled" : "") + ">" + escapeHtml(draft) + '</textarea><div><button class="composer-icon" data-action="captureEditorSelection" title="Attach editor selection">' + icon("add") + '</button><span class="composer-branch">' + icon("branch") + escapeHtml(state.snapshot.branch || basename(session.workspace)) + '</span><span class="permission-badge">' + escapeHtml(permissionName(session.permission)) + "</span>" + runButton + "</div></div></div></main>";
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

  const historyGraphColors = [
    "var(--vscode-charts-blue, #209cee)",
    "var(--vscode-charts-purple, #e30c8c)",
    "var(--vscode-charts-green, #20c75a)",
    "var(--vscode-charts-orange, #f59e0b)",
    "var(--vscode-charts-red, #f05a67)",
    "var(--vscode-charts-yellow, #d9b72b)",
    "var(--vscode-charts-foreground, #26b5ce)",
    "var(--agent-accent)"
  ];

  function historyGraphColor(index) {
    return historyGraphColors[index % historyGraphColors.length];
  }

  function historyRefEntries(refs) {
    const entries = [];
    const seen = new Set();
    for (const value of refs || []) {
      const raw = String(value || "").trim();
      if (!raw) continue;
      let label = raw;
      let head = false;
      if (raw.startsWith("HEAD -> ")) {
        label = raw.slice(8);
        head = true;
      } else if (raw.includes(" -> ")) {
        const [source, target] = raw.split(" -> ");
        if (source && /\/HEAD$/.test(source)) continue;
        label = target || source || raw;
      }
      const tag = label.startsWith("tag: ");
      if (tag) label = label.slice(5);
      const remote = label.match(/^(origin|upstream)\/(.+)$/);
      const key = (tag ? "tag:" : remote ? "remote:" : "local:") + label;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        label,
        shortLabel: remote ? remote[2] : label,
        remote: remote ? remote[1] : "",
        tag,
        head
      });
    }

    const localLabels = new Set(entries.filter((entry) => !entry.remote && !entry.tag).map((entry) => entry.label));
    return entries.filter((entry) => !entry.remote || !localLabels.has(entry.shortLabel)).map((entry) => {
      if (entry.remote || entry.tag) return entry;
      const matchingRemote = entries.find((candidate) => candidate.remote && candidate.shortLabel === entry.label);
      return matchingRemote ? Object.assign({}, entry, { remote: matchingRemote.remote }) : entry;
    }).slice(0, 3);
  }

  function historyRefsMarkup(refs, color) {
    const entries = historyRefEntries(refs);
    if (!entries.length) return "";
    return '<span class="commit-refs">' + entries.map((entry) => {
      const kind = entry.tag ? " tag" : entry.remote && entry.label.startsWith(entry.remote + "/") ? " remote" : entry.head ? " head" : "";
      const glyph = codicon(entry.tag ? "tag" : "git-branch", "", "commit-ref-glyph");
      return '<em class="commit-ref' + kind + '" style="--history-lane-color:' + attr(color) + '" title="' + attr(entry.label) + '"><span class="commit-ref-icon">' + glyph + '</span><span class="commit-ref-name">' + escapeHtml(entry.label) + "</span>" + (entry.remote && !entry.label.startsWith(entry.remote + "/") ? '<span class="commit-ref-remote">' + escapeHtml(entry.remote) + "</span>" : "") + "</em>";
    }).join("") + "</span>";
  }

  function historyDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date).replace(/,/g, "");
  }

  function historyGraphPresentation(commits) {
    const rowHeight = state.snapshot.config.density === "compact" ? 29 : 34;
    const fallback = { rowHeight, width: 132, svg: "", nodesByHash: new Map() };
    if (!commits.length || !globalThis.HistoryGraphApi) return fallback;
    try {
      const api = globalThis.HistoryGraphApi;
      const layout = api.layoutHistoryGraph(commits);
      const laneCount = Math.max(layout.laneCount, 1);
      const laneWidth = clamp(Math.floor((210 - 20) / Math.max(1, laneCount - 1)), 14, 20);
      const geometry = { rowHeight, laneWidth, offsetX: 20 };
      const graphHeight = commits.length * rowHeight;
      const lastLaneX = geometry.offsetX + (laneCount - 1) * laneWidth;
      const width = clamp(lastLaneX + 34, 132, 232);
      const paths = layout.edges.map((edge) => {
        const color = historyGraphColor(edge.colorIndex);
        return '<path class="history-graph-edge' + (edge.secondary ? " secondary" : "") + (edge.boundary ? " boundary" : "") + '" data-history-parent="' + attr(edge.toHash) + '" d="' + attr(api.historyGraphEdgePath(edge, geometry)) + '" fill="none" stroke="' + attr(color) + '"></path>';
      }).join("");
      const nodesByHash = new Map(layout.nodes.map((node) => [node.hash, node]));
      const dots = layout.nodes.map((node) => {
        const commit = commits[node.index];
        const position = api.historyGraphNodePosition(node, geometry);
        const hasRef = Boolean(commit && commit.refs && commit.refs.length);
        const isHead = Boolean(commit && commit.refs && commit.refs.some((ref) => String(ref).startsWith("HEAD -> ")));
        const color = historyGraphColor(node.colorIndex);
        return '<circle class="history-graph-node' + (hasRef ? " has-ref" : "") + (isHead ? " head" : "") + '" data-history-hash="' + attr(node.hash) + '" cx="' + position.x + '" cy="' + position.y + '" r="' + (isHead ? 4.5 : hasRef ? 4 : 3.25) + '" fill="' + (hasRef ? "var(--vscode-editor-background)" : attr(color)) + '" stroke="' + attr(color) + '"></circle>';
      }).join("");
      return {
        rowHeight,
        width,
        nodesByHash,
        svg: '<svg class="history-graph-canvas" width="' + width + '" height="' + graphHeight + '" viewBox="0 0 ' + width + " " + graphHeight + '" aria-hidden="true">' + paths + dots + "</svg>"
      };
    } catch {
      return fallback;
    }
  }

  function historyRows(commits, graph) {
    return commits.map((commit, index) => {
      const node = graph.nodesByHash.get(commit.hash);
      const color = historyGraphColor(node ? node.colorIndex : 0);
      const refs = historyRefsMarkup(commit.refs, color);
      const date = historyDate(commit.date);
      return '<button class="history-row ' + (index === 0 ? "latest " : "") + (state.selectedCommit === commit.hash ? "active" : "") + '" data-action="selectCommit" data-hash="' + attr(commit.hash) + '" title="' + attr(commit.subject) + '"><span class="history-graph-slot"></span><span class="history-description">' + refs + '<strong class="history-subject">' + escapeHtml(commit.subject) + '</strong></span><time class="history-date" datetime="' + attr(commit.date) + '">' + escapeHtml(date) + '</time><span class="history-author">' + escapeHtml(commit.author) + '</span><code class="history-hash">' + escapeHtml(commit.hash.slice(0, 8)) + "</code></button>";
    }).join("");
  }

  function historyView() {
    const commits = state.snapshot.commits || [];
    const graph = historyGraphPresentation(commits);
    const rows = commits.length ? graph.svg + historyRows(commits, graph) : '<div class="history-empty">No Git history was found for this workspace.</div>';
    return `<main class="center-pane history-view" style="--history-graph-width:${graph.width}px;--history-row-height:${graph.rowHeight}px"><header class="history-header"><div><span class="eyebrow">Repository</span><h1>Version history</h1><p>Commits across every branch and agent worktree.</p></div><div class="header-actions"><button class="secondary-button" data-action="refreshRepository">${icon("refresh")}Refresh</button></div></header><div class="history-column-header"><span>Graph</span><span>Description</span><span>Date</span><span>Author</span><span>Commit</span></div><div class="history-list">${rows}</div></main>`;
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
      const body = state.importLoading ? '<div class="modal-loading"><span class="run-spinner"></span>Scanning local agent history…</div>' : state.nativeSessions.length ? '<div class="native-list">' + state.nativeSessions.map((session) => '<button class="native-row" data-action="importNative" data-key="' + attr(session.key) + '">' + providerLogo(session.provider) + '<span><strong>' + escapeHtml(session.title) + '</strong><small>' + escapeHtml(shortPath(session.workspace)) + " · " + timeAgo(session.updatedAt) + '</small></span><em>Import →</em></button>').join("") + "</div>" : '<div class="modal-empty"><strong>No unimported sessions found</strong><p>Configured Claude, Codex, and Grok history directories were scanned.</p><button class="secondary-button" data-action="discoverNative">' + icon("refresh") + "Scan again</button></div>";
      return '<div class="modal-backdrop" data-action="closeModal"><div class="modal-card import-modal" data-modal-card><header><div><h2>Import agent history</h2><p>Connect an existing CLI session to its worktree.</p></div><button class="icon-button" data-action="closeModal">' + icon("close") + "</button></header>" + body + "</div></div>";
    }
    return "";
  }

  function worktreeContextMenu() {
    const menu = state.worktreeMenu;
    if (!menu || !state.snapshot) return "";
    const worktree = state.snapshot.worktrees.find((item) => item.path === menu.path);
    if (!worktree) return "";
    const agents = sessionsForWorktree(worktree.path);
    const deleteReason = worktree.isMain
      ? "The primary worktree cannot be deleted"
      : worktree.locked
        ? "Unlock this worktree before deleting it"
        : worktree.dirtyCount
          ? "Commit, stash, or discard changes before deleting"
          : agents.length
            ? "Archive or delete this worktree's agents first"
            : "Delete this worktree; its branch will be kept";
    const canDelete = !worktree.isMain && !worktree.locked && !worktree.dirtyCount && !agents.length;
    return '<div class="context-menu-layer" data-action="closeWorktreeMenu"><div class="worktree-context-menu" role="menu" aria-label="Actions for ' + attr(worktree.branch) + '" style="left:' + menu.x + 'px;top:' + menu.y + 'px" data-context-menu>' +
      '<div class="context-menu-heading"><strong>' + escapeHtml(worktree.branch) + '</strong><small>' + escapeHtml(shortPath(worktree.path)) + '</small></div>' +
      '<button role="menuitem" data-action="contextOpenWorktree" data-path="' + attr(worktree.path) + '">' + icon("window") + '<span>Open in New Window</span></button>' +
      '<button role="menuitem" data-action="contextNewAgent" data-path="' + attr(worktree.path) + '">' + icon("add") + '<span>New Agent Here</span></button>' +
      '<button role="menuitem" data-action="revealWorktree" data-path="' + attr(worktree.path) + '">' + icon("reveal") + '<span>Reveal in File Manager</span></button>' +
      '<button role="menuitem" data-action="copyWorktreePath" data-path="' + attr(worktree.path) + '">' + icon("copy") + '<span>Copy Worktree Path</span></button>' +
      '<div class="context-menu-separator" role="separator"></div>' +
      '<button class="danger-action" role="menuitem" data-action="deleteWorktree" data-path="' + attr(worktree.path) + '" title="' + attr(deleteReason) + '" ' + (canDelete ? "" : "disabled") + '>' + icon("trash") + '<span>Delete Worktree</span></button>' +
      '</div></div>';
  }

  function render(options) {
    if (!state.snapshot) return;
    const focusId = options && options.preserveFocus && document.activeElement && document.activeElement.id;
    const selection = focusId && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    app.className = "app density-" + state.snapshot.config.density;
    app.style.setProperty("--left-width", state.leftWidth + "px");
    app.style.setProperty("--right-width", state.rightWidth + "px");
    app.style.setProperty("--agent-accent", state.snapshot.config.accent);
    app.innerHTML = '<div class="workbench-grid">' + sidebar() + '<div class="resize-handle" data-resize="left"></div>' + centerPane() + '<div class="resize-handle" data-resize="right"></div>' + rightPane() + '</div>' + modal() + worktreeContextMenu() + '<div id="toast-region" class="toast-region" aria-live="assertive"></div>';
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
    if (typeof createWorktree === "boolean") {
      state.newWorktree = createWorktree;
      state.newBranch = createWorktree;
      state.newBaseBranch = current?.branch === "detached" ? "" : current?.branch || "";
      state.newWorkspaceBranch = current?.branch || "";
    }
    state.newProvider = state.newProvider || state.snapshot.config.defaultProvider;
    state.newPermission = state.newPermission || state.snapshot.config.defaultPermission;
    persist();
    render();
    requestAnimationFrame(() => document.getElementById("new-prompt")?.focus());
  }

  function openNewForWorktree(pathValue) {
    const worktree = state.snapshot.worktrees.find((item) => item.path === pathValue);
    if (!worktree) return;
    state.worktreeMenu = null;
    state.snapshot.selectedWorktreePath = worktree.path;
    state.newWorkspace = worktree.path;
    state.newWorktree = false;
    state.newBranch = false;
    state.newBaseBranch = worktree.branch;
    state.newWorkspaceBranch = worktree.branch;
    state.view = "new";
    persist();
    render();
    post("selectWorktree", { path: worktree.path });
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
    const prompt = attachmentPrompt();
    const workspace = state.newWorkspace || selectedWorktree()?.path;
    if (!hasComposerInput() || !workspace) {
      showToast("Choose where to start and describe the task.", "error");
      return;
    }
    state.startingSession = true;
    persist();
    render({ preserveFocus: true });
    const startWorktree = state.snapshot.worktrees.find((item) => item.path === workspace) || selectedWorktree();
    post("newSession", {
      provider: state.newProvider || state.snapshot.config.defaultProvider,
      workspace,
      permission: state.newPermission || state.snapshot.config.defaultPermission,
      model: state.newModel,
      prompt: preparePrompt(prompt, state.newPermission || state.snapshot.config.defaultPermission),
      attachments: state.attachments,
      newWorktree: state.newWorktree,
      newBranch: state.newBranch,
      baseBranch: state.newWorktree || state.newBranch ? defaultBaseBranch(startWorktree) : "",
      branchName: state.newBranch ? state.newBranchName.trim() : ""
    });
  }

  function sendPrompt() {
    const session = activeSession();
    if (!session || session.status === "running" || !hasComposerInput()) return;
    post("sendPrompt", { sessionId: session.id, prompt: preparePrompt(attachmentPrompt(), session.permission), attachments: state.attachments });
    state.newDraft = "";
    state.editorContext = null;
    state.attachments = [];
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
    state.worktreeMenu = null;
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
        if (action === "closeWorktreeMenu" && event.target !== button) return;
        if (action === "openNew") openNew(button.dataset.worktree !== "false");
        else if (action === "selectWorktree") selectWorktree(button.dataset.path);
        else if (action === "selectSession") { state.view = "chat"; persist(); post("selectSession", { sessionId: button.dataset.sessionId }); }
        else if (action === "showHistory") { state.view = "history"; persist(); render(); }
        else if (action === "createAndRun") createAndRun();
        else if (action === "sendPrompt") sendPrompt();
        else if (action === "cancelRun") { const session = activeSession(); if (session) post("cancelRun", { sessionId: session.id }); }
        else if (action === "captureEditorSelection") post("captureEditorSelection");
        else if (action === "clearContext") { state.editorContext = null; render({ preserveFocus: true }); }
        else if (action === "removeAttachment") { state.attachments = state.attachments.filter((item) => item.id !== button.dataset.attachmentId); render({ preserveFocus: true }); }
        else if (action === "rightTab") { state.rightTab = button.dataset.tab; persist(); render(); }
        else if (action === "toggleFileSearch") { state.fileSearchOpen = !state.fileSearchOpen; render(); requestAnimationFrame(() => document.getElementById("file-search")?.focus()); }
        else if (action === "toggleDirectory") toggleDirectory(button.dataset.path);
        else if (action === "toggleRoot") { state.expandedDirectories.has("") ? state.expandedDirectories.delete("") : state.expandedDirectories.add(""); render(); }
        else if (action === "openFile") post("openFile", { path: button.dataset.path });
        else if (action === "openCommitFile") post("openCommitFile", { hash: button.dataset.hash, path: button.dataset.path, status: button.dataset.status });
        else if (action === "openDiff") post("openDiff", { path: button.dataset.path });
        else if (action === "refreshRepository") post("refreshRepository");
        else if (action === "openWorktree") post("openWorktree", { path: button.dataset.path || state.snapshot.selectedWorktreePath, newWindow: true });
        else if (action === "contextOpenWorktree") { state.worktreeMenu = null; render({ preserveFocus: true }); post("openWorktree", { path: button.dataset.path, newWindow: true }); }
        else if (action === "contextNewAgent") openNewForWorktree(button.dataset.path);
        else if (action === "revealWorktree") { state.worktreeMenu = null; render({ preserveFocus: true }); post("revealWorktree", { path: button.dataset.path }); }
        else if (action === "copyWorktreePath") { state.worktreeMenu = null; render({ preserveFocus: true }); post("copyWorktreePath", { path: button.dataset.path }); }
        else if (action === "deleteWorktree") { state.worktreeMenu = null; render({ preserveFocus: true }); post("deleteWorktree", { path: button.dataset.path }); }
        else if (action === "closeWorktreeMenu") { state.worktreeMenu = null; render({ preserveFocus: true }); }
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

    app.querySelectorAll(".worktree-row").forEach((element) => {
      const showMenu = (event) => {
        event.preventDefault();
        const x = clamp(event.clientX, 6, Math.max(6, window.innerWidth - 254));
        const y = clamp(event.clientY, 6, Math.max(6, window.innerHeight - 230));
        state.worktreeMenu = { path: element.dataset.path, x, y };
        render({ preserveFocus: true });
        requestAnimationFrame(() => document.querySelector(".worktree-context-menu button")?.focus());
      };
      element.addEventListener("contextmenu", showMenu);
      element.addEventListener("keydown", (event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        const bounds = element.getBoundingClientRect();
        showMenu({
          preventDefault: () => event.preventDefault(),
          clientX: bounds.left + 20,
          clientY: bounds.top + Math.min(bounds.height, 32)
        });
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

    app.querySelectorAll("[data-file-drop]").forEach((composer) => {
      composer.addEventListener("dragenter", (event) => {
        if (!transferContainsFiles(event.dataTransfer)) return;
        event.preventDefault();
        composer.classList.add("drag-active");
      });
      composer.addEventListener("dragover", (event) => {
        if (!transferContainsFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        composer.classList.add("drag-active");
      });
      composer.addEventListener("dragleave", (event) => {
        if (!event.relatedTarget || !composer.contains(event.relatedTarget)) composer.classList.remove("drag-active");
      });
      composer.addEventListener("drop", (event) => {
        if (!transferContainsFiles(event.dataTransfer)) return;
        event.preventDefault();
        composer.classList.remove("drag-active");
        void handleAttachmentDrop(event.dataTransfer);
      });
    });

    const workspace = document.getElementById("new-workspace");
    const worktreeTarget = document.getElementById("new-worktree-target");
    const provider = document.getElementById("new-provider");
    const permission = document.getElementById("new-permission");
    const model = document.getElementById("new-model");
    const autoCommit = document.getElementById("auto-commit");
    const unrestrictedAccess = document.getElementById("unrestricted-access");
    const branchTarget = document.getElementById("new-branch-target");
    const baseBranch = document.getElementById("new-base-branch");
    const branchName = document.getElementById("new-branch-name");
    if (workspace) workspace.addEventListener("change", () => {
      const worktree = state.snapshot.worktrees.find((item) => item.path === workspace.value);
      state.newWorkspace = workspace.value;
      state.newBaseBranch = "";
      state.newWorkspaceBranch = worktree?.branch || "";
      persist();
      render({ preserveFocus: true });
    });
    if (worktreeTarget) worktreeTarget.addEventListener("change", () => {
      if (worktreeTarget.value === "__new__") {
        state.newWorktree = true;
        state.newBranch = true;
      } else {
        state.newWorktree = false;
        state.newBranch = false;
        state.newWorkspace = worktreeTarget.value;
        state.newBaseBranch = state.snapshot.worktrees.find((item) => item.path === worktreeTarget.value)?.branch || "";
        state.newWorkspaceBranch = state.newBaseBranch;
      }
      persist();
      render({ preserveFocus: true });
    });
    if (provider) provider.addEventListener("change", () => { state.newProvider = provider.value; state.newModel = state.snapshot.config.defaultModels[provider.value] || ""; persist(); render({ preserveFocus: true }); });
    if (permission) permission.addEventListener("change", () => { state.newPermission = permission.value; if (permission.value === "plan" || permission.value === "read-only") state.autoCommit = false; persist(); render({ preserveFocus: true }); });
    if (model) model.addEventListener("input", () => { state.newModel = model.value; persist(); });
    if (autoCommit) autoCommit.addEventListener("change", () => { state.autoCommit = autoCommit.checked; persist(); });
    if (unrestrictedAccess) unrestrictedAccess.addEventListener("change", () => {
      state.newPermission = unrestrictedAccess.checked ? "full-access" : "workspace-write";
      persist();
      render({ preserveFocus: true });
    });
    if (branchTarget) branchTarget.addEventListener("change", () => {
      state.newBranch = branchTarget.value === "__new__";
      if (state.newBranch && !state.newWorktree) {
        state.newBaseBranch = state.snapshot.worktrees.find((item) => item.path === state.newWorkspace)?.branch || state.snapshot.branch || "";
      } else if (!state.newBranch) {
        state.newBaseBranch = branchTarget.value;
      }
      persist();
      render({ preserveFocus: true });
    });
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
    if (button) button.classList.toggle("disabled", !hasComposerInput() || state.startingSession);
    const chatButton = document.querySelector(".conversation-composer .submit-arrow");
    if (chatButton) chatButton.classList.toggle("disabled", !hasComposerInput());
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
      const previousSnapshot = state.snapshot;
      const previousWorkspace = previousSnapshot && previousSnapshot.selectedWorktreePath;
      const previousWorktree = previousSnapshot?.worktrees.find((item) => item.path === state.newWorkspace);
      state.snapshot = message.snapshot;
      state.newProvider = state.newProvider || state.snapshot.config.defaultProvider;
      state.newPermission = state.newPermission || state.snapshot.config.defaultPermission;
      state.newWorkspace = state.newWorkspace || state.snapshot.selectedWorktreePath || state.snapshot.workspaces[0]?.path || "";
      const nextWorktree = state.snapshot.worktrees.find((item) => item.path === state.newWorkspace);
      const previousBranch = previousWorktree?.branch || state.newWorkspaceBranch;
      if (nextWorktree && nextWorktree.branch !== previousBranch && (!previousBranch || !state.newBaseBranch || state.newBaseBranch === previousBranch)) {
        state.newBaseBranch = nextWorktree.branch === "detached" ? "" : nextWorktree.branch;
      }
      if (nextWorktree) state.newWorkspaceBranch = nextWorktree.branch;
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
        state.attachments = [];
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
      syncSelectedBranch(message.branch || "detached");
      persist();
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
    else if (event.key === "Escape" && state.worktreeMenu) {
      state.worktreeMenu = null;
      render({ preserveFocus: true });
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      if (state.snapshot) openNew(true);
    }
  });

  post("ready");
})();
