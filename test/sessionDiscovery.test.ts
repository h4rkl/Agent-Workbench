import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { OutputChannel } from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDiscovery } from "../src/sessionDiscovery";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Grok session discovery", () => {
  it("discovers summary metadata and imports ACP conversation chunks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-agent-discovery-"));
    temporaryRoots.push(root);
    const grokHome = path.join(root, "grok");
    const sessionDirectory = path.join(grokHome, "sessions", "%2Frepo", "grok-session");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(path.join(sessionDirectory, "summary.json"), JSON.stringify({
      info: { id: "grok-session", cwd: "/repo" },
      generated_title: "Fix Grok support",
      updated_at: "2026-08-07T00:00:00.000Z"
    }));
    await writeFile(path.join(sessionDirectory, "updates.jsonl"), [
      { method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Fix " } } } },
      { method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "this" } } } },
      { method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } } } }
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");

    const discovery = new SessionDiscovery({ appendLine: vi.fn() } as unknown as OutputChannel);
    const summaries = await discovery.discover({
      claude: path.join(root, "claude"),
      codex: path.join(root, "codex"),
      grok: grokHome
    }, 20);

    expect(summaries).toEqual([expect.objectContaining({
      key: "grok:grok-session",
      provider: "grok",
      nativeSessionId: "grok-session",
      workspace: "/repo",
      title: "Fix Grok support"
    })]);
    const imported = await discovery.import("grok:grok-session", "workspace-write", "");
    expect(imported.provider).toBe("grok");
    expect(imported.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Fix this"],
      ["assistant", "Done"]
    ]);
  });
});
