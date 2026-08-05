import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { AgentRunner } from "./agentRunner";
import {
  getConfigSnapshot,
  getMaxDiscoveredSessions,
  shouldShowStatusBarButton
} from "./config";
import { resolveExecutable } from "./executableResolver";
import { GitService } from "./gitService";
import { SessionDiscovery } from "./sessionDiscovery";
import { SessionStore } from "./sessionStore";
import type {
  AgentEvent,
  AgentMessage,
  AgentProvider,
  AgentSession,
  CliHealth,
  PermissionMode,
  RunningAgent,
  WorkbenchSnapshot,
  WorkspaceChange,
  WorkspaceEntry
} from "./types";
import { getWebviewHtml } from "./webviewHtml";

const execFileAsync = promisify(execFile);
const PANEL_TYPE = "localAgentWorkbench.panel";

type WebviewMessage = Record<string, unknown> & { type: string };

interface ActiveRun {
  running: RunningAgent;
  assistantMessageId: string;
  reasoningMessageId?: string;
  runId: string;
  hadError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }
  return value as WebviewMessage;
}

function stringField(message: WebviewMessage, key: string): string | undefined {
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

function providerField(value: unknown): AgentProvider | undefined {
  return value === "claude" || value === "codex" ? value : undefined;
}

function permissionField(value: unknown): PermissionMode | undefined {
  return value === "plan" ||
    value === "read-only" ||
    value === "workspace-write" ||
    value === "full-access"
    ? value
    : undefined;
}

function now(): string {
  return new Date().toISOString();
}

function sessionTitle(prompt: string): string {
  const title = prompt.replace(/\s+/g, " ").trim();
  return title.length > 64 ? `${title.slice(0, 61)}…` : title;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WorkbenchController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly output = vscode.window.createOutputChannel(
    "Local Agent Workbench"
  );
  private readonly agentRunner = new AgentRunner(this.output);
  private readonly git = new GitService();
  private readonly discovery = new SessionDiscovery(this.output);
  private config = getConfigSnapshot();
  private store = new SessionStore(this.config.dataDirectory, this.output);
  private sessions: AgentSession[] = [];
  private activeSessionId: string | undefined;
  private changes: WorkspaceChange[] = [];
  private health: Record<AgentProvider, CliHealth> = {
    claude: {
      provider: "claude",
      available: false,
      executable: this.config.executableSettings.claude
    },
    codex: {
      provider: "codex",
      available: false,
      executable: this.config.executableSettings.codex
    }
  };
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly disposables: vscode.Disposable[] = [];
  private saveChain: Promise<void> = Promise.resolve();
  private initialized = false;
  private initialization: Promise<void> | undefined;
  private statusBar: vscode.StatusBarItem | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(this.output);
    this.configureStatusBar();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration("localAgentWorkbench")) {
          return;
        }
        const previousDirectory = this.config.dataDirectory;
        this.config = getConfigSnapshot();
        this.configureStatusBar();
        if (previousDirectory !== this.config.dataDirectory) {
          this.store = new SessionStore(this.config.dataDirectory, this.output);
          const loaded = await this.store.load();
          this.sessions = loaded.sessions;
          this.activeSessionId = loaded.activeSessionId;
        }
        await Promise.all([this.checkHealth(), this.refreshChanges()]);
        await this.postSnapshot();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.postSnapshot();
      })
    );
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initialization) {
      return this.initialization;
    }
    this.initialization = (async () => {
      const loaded = await this.store.load();
      this.sessions = loaded.sessions;
      this.activeSessionId =
        loaded.activeSessionId &&
        this.sessions.some((session) => session.id === loaded.activeSessionId)
          ? loaded.activeSessionId
          : this.sessions.find((session) => session.status !== "archived")?.id;
      await Promise.all([this.checkHealth(), this.refreshChanges()]);
      this.initialized = true;
    })();
    return this.initialization;
  }

  public async open(preserveFocus = false): Promise<void> {
    await this.initialize();
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, preserveFocus);
      await this.postSnapshot();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      "Local Agents",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      }
    );
    this.attachPanel(panel);
  }

  public async toggle(): Promise<void> {
    if (this.panel?.visible) {
      this.panel.dispose();
      return;
    }
    await this.open();
  }

  public async openInNewWindow(): Promise<void> {
    await this.open();
    try {
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    } catch (error) {
      this.output.appendLine(`[window] ${errorMessage(error)}`);
      void vscode.window.showInformationMessage(
        "The workbench opened in an editor tab. Your VS Code build did not expose the move-to-new-window command."
      );
    }
  }

  public async newSession(): Promise<void> {
    await this.open();
    await this.panel?.webview.postMessage({ type: "showNewSession" });
  }

  public attachPanel(panel: vscode.WebviewPanel): void {
    this.panel?.dispose();
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    panel.webview.html = getWebviewHtml(panel.webview, this.context.extensionUri);
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
    panel.webview.onDidReceiveMessage((raw) => {
      void this.handleMessage(raw);
    });
    void this.initialize().then(() => this.postSnapshot());
  }

  public async checkHealth(showNotification = false): Promise<void> {
    const results = await Promise.all(
      (["claude", "codex"] as const).map(async (provider) => {
        const configured = this.config.executableSettings[provider];
        try {
          const executable = await resolveExecutable(configured);
          const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
            encoding: "utf8",
            timeout: 8_000
          });
          return {
            provider,
            available: true,
            executable,
            version: `${stdout}${stderr}`.trim().split("\n")[0]
          } satisfies CliHealth;
        } catch (error) {
          return {
            provider,
            available: false,
            executable: configured,
            error: errorMessage(error)
          } satisfies CliHealth;
        }
      })
    );
    this.health = { claude: results[0]!, codex: results[1]! };
    if (showNotification) {
      const summary = results
        .map((item) =>
          item.available
            ? `${item.provider}: ${item.version ?? "available"}`
            : `${item.provider}: unavailable`
        )
        .join(" · ");
      void vscode.window.showInformationMessage(summary);
    }
    await this.panel?.webview.postMessage({ type: "health", health: this.health });
  }

  private configureStatusBar(): void {
    if (!shouldShowStatusBarButton()) {
      this.statusBar?.dispose();
      this.statusBar = undefined;
      return;
    }
    if (!this.statusBar) {
      this.statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        70
      );
      this.statusBar.command = "localAgentWorkbench.toggle";
      this.statusBar.name = "Local Agent Workbench";
      this.disposables.push(this.statusBar);
    }
    this.statusBar.text = "$(sparkle-filled) Local Agents";
    this.statusBar.tooltip = "Toggle the Copilot-free Local Agent Workbench";
    this.statusBar.show();
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = asMessage(raw);
    if (!message) {
      return;
    }
    try {
      switch (message.type) {
        case "ready":
          await this.postSnapshot();
          break;
        case "selectSession":
          await this.selectSession(stringField(message, "sessionId"));
          break;
        case "newSession":
          await this.createSession(message);
          break;
        case "sendPrompt":
          await this.sendPrompt(message);
          break;
        case "cancelRun":
          this.cancelRun(stringField(message, "sessionId"));
          break;
        case "updateSession":
          await this.updateSession(message);
          break;
        case "deleteSession":
          await this.deleteSession(stringField(message, "sessionId"));
          break;
        case "archiveSession":
          await this.archiveSession(stringField(message, "sessionId"));
          break;
        case "duplicateSession":
          await this.duplicateSession(stringField(message, "sessionId"));
          break;
        case "pickWorkspace":
          await this.pickWorkspace();
          break;
        case "refreshChanges":
          await this.refreshChanges(true);
          break;
        case "openFile":
          await this.openWorkspaceFile(message, false);
          break;
        case "openDiff":
          await this.openWorkspaceFile(message, true);
          break;
        case "discoverNative":
          await this.discoverNativeSessions();
          break;
        case "importNative":
          await this.importNativeSession(message);
          break;
        case "openSettings":
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:local-agent-workbench.local-agent-workbench"
          );
          break;
        case "showOutput":
          this.output.show(true);
          break;
        case "detach":
          await this.openInNewWindow();
          break;
        case "checkHealth":
          await this.checkHealth(true);
          break;
      }
    } catch (error) {
      this.output.appendLine(`[message:${message.type}] ${errorMessage(error)}`);
      await this.panel?.webview.postMessage({
        type: "notification",
        level: "error",
        message: errorMessage(error)
      });
    }
  }

  private async selectSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId || !this.sessions.some((session) => session.id === sessionId)) {
      return;
    }
    this.activeSessionId = sessionId;
    await Promise.all([this.refreshChanges(), this.queueSave()]);
    await this.postSnapshot();
  }

  private async createSession(message: WebviewMessage): Promise<void> {
    const workspace = stringField(message, "workspace");
    const provider = providerField(message.provider) ?? this.config.defaultProvider;
    const permission =
      permissionField(message.permission) ?? this.config.defaultPermission;
    const model = stringField(message, "model") ?? this.config.defaultModels[provider];
    const requestedTitle = stringField(message, "title")?.trim();
    if (!workspace) {
      throw new Error("Choose a workspace for the session.");
    }
    const metadata = await stat(workspace);
    if (!metadata.isDirectory()) {
      throw new Error("The selected workspace is not a directory.");
    }
    const timestamp = now();
    const session: AgentSession = {
      id: randomUUID(),
      provider,
      title: requestedTitle || `New ${provider === "claude" ? "Claude" : "Codex"} session`,
      workspace,
      model,
      permission,
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
      source: "workbench"
    };
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    await Promise.all([this.refreshChanges(), this.queueSave()]);
    await this.postSnapshot();
  }

  private async sendPrompt(message: WebviewMessage): Promise<void> {
    const sessionId = stringField(message, "sessionId") ?? this.activeSessionId;
    const prompt = stringField(message, "prompt")?.trim();
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || !prompt) {
      return;
    }
    if (this.activeRuns.has(session.id)) {
      throw new Error("This session is already running.");
    }
    if (prompt.length > 200_000) {
      throw new Error("The prompt exceeds the 200,000 character safety limit.");
    }
    await this.confirmWorkspaceTrust(session);
    if (session.permission === "full-access") {
      await this.confirmFullAccess(session);
    }
    const executable = await resolveExecutable(
      this.config.executableSettings[session.provider]
    );
    const timestamp = now();
    if (session.messages.length === 0 || session.title.startsWith("New ")) {
      session.title = sessionTitle(prompt);
    }
    const userMessage: AgentMessage = {
      id: randomUUID(),
      role: "user",
      content: prompt,
      createdAt: timestamp
    };
    const assistantMessage: AgentMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: timestamp,
      state: "running"
    };
    session.messages.push(userMessage, assistantMessage);
    session.status = "running";
    session.statusText = `${session.provider === "claude" ? "Claude" : "Codex"} is starting`;
    session.updatedAt = timestamp;
    await this.queueSave();
    await this.postSession(session);

    const runId = randomUUID();
    const activeRun: ActiveRun = {
      running: undefined as unknown as RunningAgent,
      assistantMessageId: assistantMessage.id,
      runId,
      hadError: false
    };
    const running = this.agentRunner.run(
      {
        session,
        prompt,
        executable,
        userDirectory: this.config.userDirectories[session.provider]
      },
      (event) => this.handleAgentEvent(session, activeRun, event)
    );
    activeRun.running = running;
    this.activeRuns.set(session.id, activeRun);

    const outcome = await running.done;
    this.activeRuns.delete(session.id);
    if (outcome.nativeSessionId) {
      session.nativeSessionId = outcome.nativeSessionId;
    }
    assistantMessage.state = activeRun.hadError ? "failed" : "completed";
    for (const item of session.messages) {
      if (item !== assistantMessage && item.state === "running") {
        item.state = activeRun.hadError ? "failed" : "completed";
      }
    }
    if (!assistantMessage.content.trim()) {
      if (outcome.cancelled) {
        assistantMessage.content = "Run cancelled.";
      } else if (activeRun.hadError) {
        assistantMessage.content = "The agent stopped before returning a response.";
      } else {
        assistantMessage.content = outcome.finalText || "Run completed without a text response.";
      }
    }
    session.status = activeRun.hadError ? "error" : "idle";
    session.statusText = outcome.cancelled
      ? "Cancelled"
      : activeRun.hadError
        ? "Run failed"
        : "Completed";
    session.updatedAt = now();
    await Promise.all([this.refreshChanges(), this.queueSave()]);
    await this.postSnapshot();
  }

  private handleAgentEvent(
    session: AgentSession,
    activeRun: ActiveRun,
    event: AgentEvent
  ): void {
    const assistant = session.messages.find(
      (message) => message.id === activeRun.assistantMessageId
    );
    if (!assistant) {
      return;
    }

    if (event.type === "native-session") {
      session.nativeSessionId = event.sessionId;
      void this.postMeta(session);
      return;
    }
    if (event.type === "assistant-delta") {
      assistant.content += event.text;
      void this.panel?.webview.postMessage({
        type: "messageDelta",
        sessionId: session.id,
        messageId: assistant.id,
        delta: event.text
      });
      return;
    }
    if (event.type === "assistant") {
      if (assistant.content && !assistant.content.endsWith("\n")) {
        assistant.content += "\n";
      }
      assistant.content += event.text;
      void this.postMessageUpsert(session.id, assistant);
      return;
    }
    if (event.type === "reasoning-delta") {
      let reasoning = activeRun.reasoningMessageId
        ? session.messages.find((item) => item.id === activeRun.reasoningMessageId)
        : undefined;
      if (!reasoning) {
        reasoning = {
          id: randomUUID(),
          role: "reasoning",
          title: "Reasoning",
          content: "",
          createdAt: now(),
          state: "running"
        };
        activeRun.reasoningMessageId = reasoning.id;
        const assistantIndex = session.messages.indexOf(assistant);
        session.messages.splice(Math.max(assistantIndex, 0), 0, reasoning);
      }
      reasoning.content += event.text;
      void this.postMessageUpsert(session.id, reasoning);
      return;
    }
    if (event.type === "tool") {
      const messageId = `${activeRun.runId}:${event.id}`;
      let tool = session.messages.find((item) => item.id === messageId);
      if (!tool) {
        tool = {
          id: messageId,
          role: "tool",
          title: event.title,
          content: event.content,
          createdAt: now(),
          state: event.state
        };
        const assistantIndex = session.messages.indexOf(assistant);
        session.messages.splice(Math.max(assistantIndex, 0), 0, tool);
      } else {
        tool.title = event.title;
        tool.content = event.content;
        tool.state = event.state;
      }
      void this.postMessageUpsert(session.id, tool);
      return;
    }
    if (event.type === "status") {
      session.statusText = event.text.slice(0, 160);
      void this.postMeta(session);
      return;
    }
    if (event.type === "usage") {
      assistant.metadata = { ...(assistant.metadata ?? {}), usage: event.usage };
      void this.postMessageUpsert(session.id, assistant);
      return;
    }
    if (event.type === "error") {
      activeRun.hadError = true;
      session.status = "error";
      session.statusText = event.message.slice(0, 160);
      const error: AgentMessage = {
        id: randomUUID(),
        role: "error",
        title: "Agent error",
        content: event.message,
        createdAt: now(),
        state: "failed"
      };
      session.messages.push(error);
      void this.postMessageUpsert(session.id, error);
      void this.postMeta(session);
    }
  }

  private cancelRun(sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }
    this.activeRuns.get(sessionId)?.running.cancel();
  }

  private async updateSession(message: WebviewMessage): Promise<void> {
    const sessionId = stringField(message, "sessionId");
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || this.activeRuns.has(session.id)) {
      return;
    }
    const title = stringField(message, "title")?.trim();
    const model = stringField(message, "model");
    const permission = permissionField(message.permission);
    if (title) {
      session.title = title.slice(0, 120);
    }
    if (model !== undefined) {
      session.model = model.trim();
    }
    if (permission) {
      session.permission = permission;
    }
    session.updatedAt = now();
    await this.queueSave();
    await this.postSession(session);
  }

  private async deleteSession(sessionId: string | undefined): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Delete '${session.title}' from Local Agent Workbench? Native Claude/Codex transcripts are not deleted.`,
      { modal: true },
      "Delete"
    );
    if (choice !== "Delete") {
      return;
    }
    this.activeRuns.get(session.id)?.running.cancel();
    this.sessions = this.sessions.filter((candidate) => candidate.id !== session.id);
    this.activeSessionId = this.sessions.find(
      (candidate) => candidate.status !== "archived"
    )?.id;
    await Promise.all([this.refreshChanges(), this.queueSave()]);
    await this.postSnapshot();
  }

  private async archiveSession(sessionId: string | undefined): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session || this.activeRuns.has(session.id)) {
      return;
    }
    const archiving = session.status !== "archived";
    session.status = archiving ? "archived" : "idle";
    session.updatedAt = now();
    if (archiving && this.activeSessionId === session.id) {
      this.activeSessionId = this.sessions.find(
        (candidate) => candidate.id !== session.id && candidate.status !== "archived"
      )?.id;
    }
    await Promise.all([this.refreshChanges(), this.queueSave()]);
    await this.postSnapshot();
  }

  private async duplicateSession(sessionId: string | undefined): Promise<void> {
    const source = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!source) {
      return;
    }
    const timestamp = now();
    const duplicate: AgentSession = {
      ...source,
      id: randomUUID(),
      nativeSessionId: undefined,
      title: `${source.title} (copy)`,
      status: "idle",
      statusText: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: source.messages.map((message) => ({
        ...message,
        id: randomUUID(),
        state: message.state === "running" ? "completed" : message.state
      })),
      source: "workbench"
    };
    this.sessions.unshift(duplicate);
    this.activeSessionId = duplicate.id;
    await this.queueSave();
    await this.postSnapshot();
  }

  private async pickWorkspace(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use as agent workspace"
    });
    const selectedPath = selected?.[0]?.fsPath;
    if (selectedPath) {
      await this.panel?.webview.postMessage({
        type: "workspacePicked",
        workspace: selectedPath,
        name: path.basename(selectedPath)
      });
    }
  }

  private async refreshChanges(post = false): Promise<void> {
    const session = this.getActiveSession();
    this.changes = session ? await this.git.listChanges(session.workspace) : [];
    if (post) {
      await this.panel?.webview.postMessage({
        type: "changes",
        changes: this.changes
      });
    }
  }

  private async openWorkspaceFile(
    message: WebviewMessage,
    diff: boolean
  ): Promise<void> {
    const relativePath = stringField(message, "path");
    const session = this.getActiveSession();
    if (!relativePath || !session) {
      return;
    }
    if (diff) {
      await this.git.openDiff(session.workspace, relativePath);
    } else {
      await this.git.openFile(session.workspace, relativePath);
    }
  }

  private async discoverNativeSessions(): Promise<void> {
    const summaries = await this.discovery.discover(
      this.config.userDirectories,
      getMaxDiscoveredSessions()
    );
    const imported = new Set(
      this.sessions
        .filter((session) => session.nativeSessionId)
        .map((session) => `${session.provider}:${session.nativeSessionId}`)
    );
    await this.panel?.webview.postMessage({
      type: "nativeSessions",
      sessions: summaries.filter((summary) => !imported.has(summary.key))
    });
  }

  private async importNativeSession(message: WebviewMessage): Promise<void> {
    const key = stringField(message, "key");
    if (!key) {
      return;
    }
    const provider = key.startsWith("codex:") ? "codex" : "claude";
    const session = await this.discovery.import(
      key,
      this.config.defaultPermission,
      this.config.defaultModels[provider]
    );
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    await Promise.all([this.refreshChanges(), this.queueSave()]);
    await this.postSnapshot();
  }

  private async confirmWorkspaceTrust(session: AgentSession): Promise<void> {
    const trustKey = `trustedWorkspace:${session.workspace}`;
    if (this.context.globalState.get<boolean>(trustKey)) {
      return;
    }
    const selected = await vscode.window.showWarningMessage(
      `${session.provider === "claude" ? "Claude Code" : "Codex"} will run locally with access to ${session.workspace}. Only continue if you trust this folder and its instructions.`,
      { modal: true },
      "Trust and Run"
    );
    if (selected !== "Trust and Run") {
      throw new Error("Run cancelled because the workspace was not trusted.");
    }
    await this.context.globalState.update(trustKey, true);
  }

  private async confirmFullAccess(session: AgentSession): Promise<void> {
    const confirmationKey = `fullAccessConfirmed:${session.workspace}`;
    if (this.context.globalState.get<boolean>(confirmationKey)) {
      return;
    }
    const selected = await vscode.window.showWarningMessage(
      "Full access disables the provider sandbox and approval prompts. The agent can execute arbitrary commands and modify files outside the workspace.",
      { modal: true },
      "Enable Full Access"
    );
    if (selected !== "Enable Full Access") {
      throw new Error("Full-access run cancelled.");
    }
    await this.context.globalState.update(confirmationKey, true);
  }

  private getActiveSession(): AgentSession | undefined {
    return this.sessions.find((session) => session.id === this.activeSessionId);
  }

  private workspaceEntries(): WorkspaceEntry[] {
    const entries = new Map<string, WorkspaceEntry>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      entries.set(folder.uri.fsPath, {
        path: folder.uri.fsPath,
        name: folder.name,
        active: false
      });
    }
    for (const session of this.sessions) {
      if (!entries.has(session.workspace)) {
        entries.set(session.workspace, {
          path: session.workspace,
          name: path.basename(session.workspace),
          active: false
        });
      }
    }
    const activeWorkspace = this.getActiveSession()?.workspace;
    return [...entries.values()]
      .map((entry) => ({ ...entry, active: entry.path === activeWorkspace }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }

  private snapshot(): WorkbenchSnapshot {
    return {
      sessions: [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      activeSessionId: this.activeSessionId,
      workspaces: this.workspaceEntries(),
      health: this.health,
      changes: this.changes,
      config: this.config
    };
  }

  private async postSnapshot(): Promise<void> {
    await this.panel?.webview.postMessage({ type: "snapshot", snapshot: this.snapshot() });
  }

  private async postSession(session: AgentSession): Promise<void> {
    await this.panel?.webview.postMessage({ type: "session", session });
  }

  private async postMeta(session: AgentSession): Promise<void> {
    await this.panel?.webview.postMessage({
      type: "sessionMeta",
      sessionId: session.id,
      patch: {
        nativeSessionId: session.nativeSessionId,
        title: session.title,
        status: session.status,
        statusText: session.statusText,
        updatedAt: session.updatedAt
      }
    });
  }

  private async postMessageUpsert(
    sessionId: string,
    message: AgentMessage
  ): Promise<void> {
    await this.panel?.webview.postMessage({
      type: "messageUpsert",
      sessionId,
      message
    });
  }

  private queueSave(): Promise<void> {
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(() => this.store.save(this.sessions, this.activeSessionId))
      .catch((error) => {
        this.output.appendLine(`[store] ${errorMessage(error)}`);
      });
    return this.saveChain;
  }

  public dispose(): void {
    for (const run of this.activeRuns.values()) {
      run.running.cancel();
    }
    this.activeRuns.clear();
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

export function registerWorkbench(
  context: vscode.ExtensionContext
): WorkbenchController {
  const controller = new WorkbenchController(context);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand("localAgentWorkbench.toggle", () =>
      controller.toggle()
    ),
    vscode.commands.registerCommand("localAgentWorkbench.open", () =>
      controller.open()
    ),
    vscode.commands.registerCommand("localAgentWorkbench.openInNewWindow", () =>
      controller.openInNewWindow()
    ),
    vscode.commands.registerCommand("localAgentWorkbench.newSession", () =>
      controller.newSession()
    ),
    vscode.commands.registerCommand("localAgentWorkbench.checkAgents", () =>
      controller.checkHealth(true)
    ),
    vscode.window.registerWebviewPanelSerializer(PANEL_TYPE, {
      deserializeWebviewPanel: async (panel) => {
        controller.attachPanel(panel);
      }
    })
  );
  void controller.initialize();
  return controller;
}
