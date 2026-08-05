import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { OutputChannel } from "vscode";
import type { AgentSession } from "./types";

interface StoreFile {
  version: 1;
  activeSessionId?: string;
  sessions: AgentSession[];
}

function isAgentSession(value: unknown): value is AgentSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AgentSession>;
  return (
    typeof candidate.id === "string" &&
    (candidate.provider === "claude" || candidate.provider === "codex") &&
    typeof candidate.workspace === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.messages)
  );
}

export class SessionStore {
  public constructor(
    private readonly dataDirectory: string,
    private readonly output: OutputChannel
  ) {}

  private get filePath(): string {
    return path.join(this.dataDirectory, "sessions.json");
  }

  public async load(): Promise<StoreFile> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Session store is not an object");
      }
      const candidate = parsed as Partial<StoreFile>;
      const sessions = Array.isArray(candidate.sessions)
        ? candidate.sessions.filter(isAgentSession).map((session) => ({
            ...session,
            status: session.status === "running" ? "idle" : session.status,
            statusText: undefined
          }))
        : [];
      return {
        version: 1,
        activeSessionId:
          typeof candidate.activeSessionId === "string"
            ? candidate.activeSessionId
            : undefined,
        sessions
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.output.appendLine(
          `[store] Unable to load ${this.filePath}: ${(error as Error).message}`
        );
      }
      return { version: 1, sessions: [] };
    }
  }

  public async save(
    sessions: readonly AgentSession[],
    activeSessionId?: string
  ): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const payload: StoreFile = {
      version: 1,
      activeSessionId,
      sessions: [...sessions]
    };
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}
