import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("workbench webview", () => {
  it("renders the worktree-first shell from a snapshot", async () => {
    const handlers = new Map<string, (event: { data: unknown }) => void>();
    const postMessage = vi.fn();
    const app = {
      className: "",
      innerHTML: "",
      style: { setProperty: vi.fn() },
      querySelectorAll: () => []
    };

    Object.assign(globalThis, {
      acquireVsCodeApi: () => ({ getState: () => ({}), setState: vi.fn(), postMessage }),
      document: {
        activeElement: null,
        getElementById: (id: string) => id === "app" ? app : null,
        querySelector: () => null
      },
      window: {
        innerWidth: 1800,
        addEventListener: (type: string, handler: (event: { data: unknown }) => void) => handlers.set(type, handler),
        removeEventListener: vi.fn()
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      CSS: { escape: (value: string) => value }
    });

    const script = await readFile(join(process.cwd(), "media", "workbench.js"), "utf8");
    Function(script)();

    expect(postMessage).toHaveBeenCalledWith({ type: "ready" });
    handlers.get("message")?.({
      data: {
        type: "snapshot",
        snapshot: {
          sessions: [],
          workspaces: [{ path: "/repo", name: "repo", active: true }],
          health: {
            claude: { provider: "claude", available: true, executable: "claude" },
            codex: { provider: "codex", available: true, executable: "codex" }
          },
          changes: [],
          files: [{ name: "src", path: "src", type: "directory" }],
          fileWorkspace: { path: "/repo", name: "repo", active: true },
          branch: "main",
          repositoryRoot: "/repo",
          worktrees: [{
            path: "/repo",
            head: "0123456789abcdef",
            branch: "main",
            isMain: true,
            detached: false,
            locked: false,
            dirtyCount: 0
          }],
          commits: [{
            hash: "0123456789abcdef",
            parents: [],
            author: "Developer",
            email: "dev@example.com",
            date: new Date().toISOString(),
            subject: "Initial commit",
            refs: ["HEAD -> main"]
          }],
          selectedWorktreePath: "/repo",
          config: {
            accent: "#8b5cf6",
            density: "comfortable",
            defaultProvider: "codex",
            defaultPermission: "workspace-write",
            defaultModels: { claude: "", codex: "" },
            dataDirectory: "/data",
            userDirectories: { claude: "/claude", codex: "/codex" },
            executableSettings: { claude: "claude", codex: "codex" }
          }
        }
      }
    });

    expect(app.innerHTML).toContain("New parallel task");
    expect(app.innerHTML).toContain("New agent in");
    expect(app.innerHTML).toContain("New Worktree");
    expect(app.innerHTML).toContain("Repository history");
    expect(app.innerHTML).toContain("repo");
    expect(app.innerHTML).toContain("codicon-folder");
    expect(script).toContain('icon: "diff-modified"');
  });
});
