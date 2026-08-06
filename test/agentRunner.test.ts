import { describe, expect, it } from "vitest";
import { buildCodexArgs, buildGrokArgs, grokPermissionArgs } from "../src/agentRunner";
import type { RunRequest } from "../src/types";

function request(nativeSessionId?: string): RunRequest {
  return {
    executable: "grok",
    prompt: "Fix the test",
    userDirectory: "/profiles/grok",
    session: {
      id: "workbench-session",
      nativeSessionId,
      provider: "grok",
      title: "Grok task",
      workspace: "/repo",
      model: "grok-build",
      permission: "workspace-write",
      status: "idle",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
      source: "workbench"
    }
  };
}

describe("Grok runner arguments", () => {
  it("maps workbench permission boundaries to Grok permissions and sandboxes", () => {
    expect(grokPermissionArgs("plan")).toEqual([
      "--permission-mode", "plan", "--sandbox", "read-only"
    ]);
    expect(grokPermissionArgs("read-only")).toEqual([
      "--permission-mode", "dontAsk", "--sandbox", "read-only"
    ]);
    expect(grokPermissionArgs("workspace-write")).toEqual([
      "--always-approve", "--sandbox", "workspace"
    ]);
    expect(grokPermissionArgs("full-access")).toEqual([
      "--always-approve", "--sandbox", "off"
    ]);
  });

  it("uses streaming JSON, a private prompt file, models, and native resume IDs", () => {
    expect(buildGrokArgs(request("grok-session"), "/tmp/prompt.txt")).toEqual([
      "--no-auto-update",
      "--output-format", "streaming-json",
      "--always-approve",
      "--model", "grok-build",
      "--resume", "grok-session",
      "--prompt-file", "/tmp/prompt.txt"
    ]);
  });

  it("lets resumed sessions restore their saved Grok sandbox profile", () => {
    expect(grokPermissionArgs("workspace-write", false)).toEqual([
      "--always-approve"
    ]);
  });
});

describe("Codex runner attachments", () => {
  it("passes dropped images to new and resumed Codex turns", () => {
    const base = request();
    const codexRequest: RunRequest = {
      ...base,
      executable: "codex",
      attachments: [
        { name: "screen.png", path: "/repo/.attachments/screen.png", mimeType: "image/png", size: 42 },
        { name: "diagram.svg", path: "/repo/.attachments/diagram.svg", mimeType: "image/svg+xml", size: 25 },
        { name: "notes.txt", path: "/repo/.attachments/notes.txt", mimeType: "text/plain", size: 12 }
      ],
      session: { ...base.session, provider: "codex", model: "" }
    };

    expect(buildCodexArgs(codexRequest)).toEqual([
      "exec", "--json", "-c", 'approval_policy="never"', "-c", 'sandbox_mode="workspace-write"',
      "--image", "/repo/.attachments/screen.png", "--cd", "/repo", "--skip-git-repo-check", "-"
    ]);

    codexRequest.session.nativeSessionId = "codex-session";
    expect(buildCodexArgs(codexRequest)).toEqual([
      "exec", "resume", "--json", "-c", 'approval_policy="never"', "-c", 'sandbox_mode="workspace-write"',
      "--image", "/repo/.attachments/screen.png", "codex-session", "-"
    ]);
  });
});
