import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import type { OutputChannel } from "vscode";
import type {
  AgentMessage,
  AgentProvider,
  AgentSession,
  NativeSessionSummary,
  PermissionMode
} from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function compactTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80) || "Imported session";
}

function contentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }
      if (item.type === "text") {
        return stringValue(item.text) ?? "";
      }
      if (item.type === "tool_use") {
        return `Used ${stringValue(item.name) ?? "tool"}`;
      }
      if (item.type === "tool_result") {
        return contentText(item.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function conversationalText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((item) => {
      if (!isRecord(item) || item.type !== "text") {
        return "";
      }
      return stringValue(item.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

async function walkFiles(
  root: string,
  limit: number,
  matches: (name: string) => boolean
): Promise<string[]> {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  const queue = [root];

  while (queue.length > 0 && candidates.length < limit * 4) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.isFile() && matches(entry.name)) {
        try {
          const metadata = await stat(entryPath);
          candidates.push({ path: entryPath, mtimeMs: metadata.mtimeMs });
        } catch {
          // A session may disappear while discovery is running.
        }
      }
    }
  }

  return candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((candidate) => candidate.path);
}

function walkJsonl(root: string, limit: number): Promise<string[]> {
  return walkFiles(root, limit, (name) => name.endsWith(".jsonl"));
}

function walkGrokSummaries(root: string, limit: number): Promise<string[]> {
  return walkFiles(root, limit, (name) => name === "summary.json");
}

async function readJsonLines(
  filePath: string,
  onLine: (value: JsonRecord) => boolean | void
): Promise<void> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const value: unknown = JSON.parse(line);
        if (isRecord(value) && onLine(value) === false) {
          break;
        }
      } catch {
        // Ignore incomplete or obsolete transcript records.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

async function summarizeCodex(filePath: string): Promise<NativeSessionSummary | undefined> {
  let nativeSessionId = "";
  let workspace = "";
  let title = "";
  let timestamp = "";

  await readJsonLines(filePath, (record) => {
    if (record.type === "session_meta" && isRecord(record.payload)) {
      nativeSessionId =
        stringValue(record.payload.id) ??
        stringValue(record.payload.session_id) ??
        nativeSessionId;
      workspace = stringValue(record.payload.cwd) ?? workspace;
      timestamp = stringValue(record.payload.timestamp) ?? timestamp;
    }
    if (
      record.type === "event_msg" &&
      isRecord(record.payload) &&
      record.payload.type === "user_message" &&
      !title
    ) {
      title = compactTitle(stringValue(record.payload.message) ?? "");
    }
    return !(nativeSessionId && workspace && title);
  });

  if (!nativeSessionId || !workspace) {
    return undefined;
  }
  const metadata = await stat(filePath);
  return {
    key: `codex:${nativeSessionId}`,
    provider: "codex",
    nativeSessionId,
    workspace,
    title: title || "Codex session",
    updatedAt: timestamp || metadata.mtime.toISOString(),
    sourcePath: filePath
  };
}

async function summarizeClaude(filePath: string): Promise<NativeSessionSummary | undefined> {
  let nativeSessionId = path.basename(filePath, ".jsonl");
  let workspace = "";
  let title = "";
  let timestamp = "";

  await readJsonLines(filePath, (record) => {
    nativeSessionId = stringValue(record.sessionId) ?? nativeSessionId;
    workspace = stringValue(record.cwd) ?? workspace;
    timestamp = stringValue(record.timestamp) ?? timestamp;
    if (record.type === "ai-title") {
      title = compactTitle(
        stringValue(record.aiTitle) ??
          stringValue(record.title) ??
          stringValue(record.value) ??
          title
      );
    }
    if (record.type === "user" && isRecord(record.message) && !title) {
      title = compactTitle(contentText(record.message.content));
    }
    return !(workspace && title);
  });

  if (!nativeSessionId || !workspace) {
    return undefined;
  }
  const metadata = await stat(filePath);
  return {
    key: `claude:${nativeSessionId}`,
    provider: "claude",
    nativeSessionId,
    workspace,
    title: title || "Claude session",
    updatedAt: timestamp || metadata.mtime.toISOString(),
    sourcePath: filePath
  };
}

async function summarizeGrok(filePath: string): Promise<NativeSessionSummary | undefined> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.info)) {
    return undefined;
  }
  const nativeSessionId = stringValue(parsed.info.id) ?? "";
  const workspace = stringValue(parsed.info.cwd) ?? "";
  if (!nativeSessionId || !workspace) {
    return undefined;
  }
  const metadata = await stat(filePath);
  const title = compactTitle(
    stringValue(parsed.generated_title) ??
      stringValue(parsed.session_summary) ??
      "Grok session"
  );
  return {
    key: `grok:${nativeSessionId}`,
    provider: "grok",
    nativeSessionId,
    workspace,
    title,
    updatedAt:
      stringValue(parsed.last_active_at) ??
      stringValue(parsed.updated_at) ??
      metadata.mtime.toISOString(),
    sourcePath: path.join(path.dirname(filePath), "updates.jsonl")
  };
}

function pushMessage(
  messages: AgentMessage[],
  role: AgentMessage["role"],
  content: string,
  timestamp?: string
): void {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }
  messages.push({
    id: `imported-${messages.length}-${Date.now()}`,
    role,
    content: trimmed,
    createdAt: timestamp || new Date().toISOString()
  });
  if (messages.length > 200) {
    messages.shift();
  }
}

async function readCodexHistory(filePath: string): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  await readJsonLines(filePath, (record) => {
    if (record.type !== "event_msg" || !isRecord(record.payload)) {
      return;
    }
    if (record.payload.type === "user_message") {
      pushMessage(messages, "user", stringValue(record.payload.message) ?? "", stringValue(record.timestamp));
    } else if (record.payload.type === "agent_message") {
      pushMessage(messages, "assistant", stringValue(record.payload.message) ?? "", stringValue(record.timestamp));
    }
  });
  return messages;
}

async function readClaudeHistory(filePath: string): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  await readJsonLines(filePath, (record) => {
    if (!isRecord(record.message)) {
      return;
    }
    if (record.type === "user") {
      pushMessage(
        messages,
        "user",
        conversationalText(record.message.content),
        stringValue(record.timestamp)
      );
    } else if (record.type === "assistant") {
      pushMessage(
        messages,
        "assistant",
        conversationalText(record.message.content),
        stringValue(record.timestamp)
      );
    }
  });
  return messages;
}

function appendGrokMessage(
  messages: AgentMessage[],
  role: "user" | "assistant",
  content: string,
  timestamp?: string
): void {
  if (!content.trim()) {
    return;
  }
  const previous = messages.at(-1);
  if (previous?.role === role) {
    previous.content += content;
    return;
  }
  messages.push({
    id: `imported-${messages.length}-${Date.now()}`,
    role,
    content,
    createdAt: timestamp || new Date().toISOString()
  });
  if (messages.length > 200) {
    messages.shift();
  }
}

async function readGrokHistory(filePath: string): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  await readJsonLines(filePath, (record) => {
    const params = recordValue(record.params);
    const update = recordValue(params?.update);
    const content = recordValue(update?.content);
    const text = stringValue(content?.text) ?? "";
    const timestamp = stringValue(record.timestamp);
    if (update?.sessionUpdate === "user_message_chunk") {
      appendGrokMessage(messages, "user", text, timestamp);
    } else if (update?.sessionUpdate === "agent_message_chunk") {
      appendGrokMessage(messages, "assistant", text, timestamp);
    }
  });
  return messages;
}

export class SessionDiscovery {
  private readonly cache = new Map<string, NativeSessionSummary>();

  public constructor(private readonly output: OutputChannel) {}

  public async discover(
    userDirectories: Record<AgentProvider, string>,
    limit: number
  ): Promise<NativeSessionSummary[]> {
    const perProvider = Math.max(5, Math.ceil(limit / 3));
    const [claudePaths, codexPaths, grokPaths] = await Promise.all([
      walkJsonl(path.join(userDirectories.claude, "projects"), perProvider),
      walkJsonl(path.join(userDirectories.codex, "sessions"), perProvider),
      walkGrokSummaries(path.join(userDirectories.grok, "sessions"), perProvider)
    ]);
    const summaries = (
      await Promise.all([
        ...claudePaths.map(async (filePath) => {
          try {
            return await summarizeClaude(filePath);
          } catch (error) {
            this.output.appendLine(`[discovery] ${filePath}: ${(error as Error).message}`);
            return undefined;
          }
        }),
        ...codexPaths.map(async (filePath) => {
          try {
            return await summarizeCodex(filePath);
          } catch (error) {
            this.output.appendLine(`[discovery] ${filePath}: ${(error as Error).message}`);
            return undefined;
          }
        }),
        ...grokPaths.map(async (filePath) => {
          try {
            return await summarizeGrok(filePath);
          } catch (error) {
            this.output.appendLine(`[discovery] ${filePath}: ${(error as Error).message}`);
            return undefined;
          }
        })
      ])
    )
      .filter((item): item is NativeSessionSummary => Boolean(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);

    this.cache.clear();
    for (const summary of summaries) {
      this.cache.set(summary.key, summary);
    }
    return summaries;
  }

  public async import(
    key: string,
    permission: PermissionMode,
    model: string
  ): Promise<AgentSession> {
    const summary = this.cache.get(key);
    if (!summary) {
      throw new Error("The discovered session is no longer available. Refresh and try again.");
    }
    const messages = summary.provider === "claude"
      ? await readClaudeHistory(summary.sourcePath)
      : summary.provider === "grok"
        ? await readGrokHistory(summary.sourcePath)
        : await readCodexHistory(summary.sourcePath);
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      nativeSessionId: summary.nativeSessionId,
      provider: summary.provider,
      title: summary.title,
      workspace: summary.workspace,
      model,
      permission,
      status: "idle",
      createdAt: now,
      updatedAt: summary.updatedAt || now,
      messages,
      source: "imported"
    };
  }
}
