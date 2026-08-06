export type AgentProvider = "claude" | "codex" | "grok";

export type PermissionMode =
  | "plan"
  | "read-only"
  | "workspace-write"
  | "full-access";

export type SessionStatus = "idle" | "running" | "error" | "archived";

export type MessageRole =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool"
  | "system"
  | "error";

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  title?: string;
  state?: "running" | "completed" | "failed";
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  nativeSessionId?: string;
  provider: AgentProvider;
  title: string;
  workspace: string;
  model: string;
  permission: PermissionMode;
  status: SessionStatus;
  statusText?: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
  source: "workbench" | "imported";
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  active: boolean;
}

export interface CliHealth {
  provider: AgentProvider;
  available: boolean;
  executable: string;
  version?: string;
  error?: string;
}

export interface WorkspaceChange {
  path: string;
  status: string;
  staged: boolean;
  untracked: boolean;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
  detached: boolean;
  locked: boolean;
  dirtyCount: number;
}

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface GitCommitFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface NativeSessionSummary {
  key: string;
  provider: AgentProvider;
  nativeSessionId: string;
  workspace: string;
  title: string;
  updatedAt: string;
  sourcePath: string;
}

export interface WorkbenchConfigSnapshot {
  accent: string;
  density: "compact" | "comfortable";
  defaultProvider: AgentProvider;
  defaultPermission: PermissionMode;
  defaultModels: Record<AgentProvider, string>;
  dataDirectory: string;
  userDirectories: Record<AgentProvider, string>;
  executableSettings: Record<AgentProvider, string>;
}

export interface WorkbenchSnapshot {
  sessions: AgentSession[];
  activeSessionId?: string;
  workspaces: WorkspaceEntry[];
  health: Record<AgentProvider, CliHealth>;
  changes: WorkspaceChange[];
  files: WorkspaceFileEntry[];
  fileWorkspace?: WorkspaceEntry;
  branch: string;
  branches: string[];
  repositoryRoot?: string;
  worktrees: WorktreeInfo[];
  commits: GitCommit[];
  selectedWorktreePath?: string;
  config: WorkbenchConfigSnapshot;
}

export type AgentEvent =
  | { type: "native-session"; sessionId: string }
  | { type: "assistant-delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "reasoning-delta"; text: string }
  | {
      type: "tool";
      id: string;
      title: string;
      content: string;
      state: "running" | "completed" | "failed";
    }
  | { type: "status"; text: string }
  | { type: "usage"; usage: Record<string, unknown> }
  | { type: "error"; message: string };

export interface RunRequest {
  session: AgentSession;
  prompt: string;
  executable: string;
  userDirectory: string;
}

export interface RunOutcome {
  exitCode: number | null;
  cancelled: boolean;
  nativeSessionId?: string;
  finalText: string;
}

export interface RunningAgent {
  done: Promise<RunOutcome>;
  cancel(): void;
}
