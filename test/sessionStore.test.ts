import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { OutputChannel } from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "../src/sessionStore";
import type { AgentSession } from "../src/types";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "local-agent-store-"));
  temporaryRoots.push(directory);
  return directory;
}

function outputChannel(): OutputChannel {
  return { appendLine: vi.fn() } as unknown as OutputChannel;
}

function session(status: AgentSession["status"] = "idle"): AgentSession {
  return {
    id: "session-1",
    provider: "codex",
    title: "Test session",
    workspace: "/tmp/project",
    model: "",
    permission: "workspace-write",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    source: "workbench"
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("SessionStore", () => {
  it("atomically persists and reloads session metadata", async () => {
    const root = await temporaryDirectory();
    const dataDirectory = path.join(root, "data");
    const store = new SessionStore(dataDirectory, outputChannel());

    await store.save([session()], "session-1");

    const result = await store.load();
    expect(result.activeSessionId).toBe("session-1");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.title).toBe("Test session");

    const stored = JSON.parse(
      await readFile(path.join(dataDirectory, "sessions.json"), "utf8")
    ) as { version: number };
    expect(stored.version).toBe(1);

    if (process.platform !== "win32") {
      const metadata = await stat(path.join(dataDirectory, "sessions.json"));
      expect(metadata.mode & 0o777).toBe(0o600);
    }
  });

  it("recovers sessions that were running when VS Code exited", async () => {
    const root = await temporaryDirectory();
    const store = new SessionStore(path.join(root, "data"), outputChannel());
    await store.save([session("running")], "session-1");

    const result = await store.load();
    expect(result.sessions[0]?.status).toBe("idle");
    expect(result.sessions[0]?.statusText).toBeUndefined();
  });

  it("returns an empty store when no data exists", async () => {
    const root = await temporaryDirectory();
    const store = new SessionStore(path.join(root, "missing"), outputChannel());
    await expect(store.load()).resolves.toEqual({ version: 1, sessions: [] });
  });
});
