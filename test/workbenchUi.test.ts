import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  historyGraphEdgePath,
  historyGraphNodePosition,
  layoutHistoryGraph
} from "../src/historyGraph";
import { describe, expect, it, vi } from "vitest";

describe("workbench webview", () => {
  it("renders the worktree-first shell from a snapshot", async () => {
    const handlers = new Map<string, (event: { data: unknown }) => void>();
    const postMessage = vi.fn();
    const showHistoryHandlers = new Map<string, (event: Record<string, unknown>) => void>();
    const showHistoryButton = {
      dataset: { action: "showHistory" },
      classList: { contains: () => false },
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => showHistoryHandlers.set(type, handler)
    };
    const worktreeRowHandlers = new Map<string, (event: Record<string, unknown>) => void>();
    const worktreeRow = {
      dataset: { path: "/repo-worktrees/codex-feature" },
      addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => worktreeRowHandlers.set(type, handler),
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 250, height: 49 })
    };
    const app = {
      className: "",
      innerHTML: "",
      style: { setProperty: vi.fn() },
      querySelectorAll: (selector: string) => {
        if (selector === "[data-action]") return [showHistoryButton];
        if (selector === ".worktree-row") return [worktreeRow];
        return [];
      }
    };

    Object.assign(globalThis, {
      acquireVsCodeApi: () => ({ getState: () => ({}), setState: vi.fn(), postMessage }),
      HistoryGraphApi: {
        historyGraphEdgePath,
        historyGraphNodePosition,
        layoutHistoryGraph
      },
      document: {
        activeElement: null,
        getElementById: (id: string) => id === "app" ? app : null,
        querySelector: () => null
      },
      window: {
        innerWidth: 1800,
        innerHeight: 1000,
        setTimeout,
        clearTimeout,
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
          branches: ["main", "stable"],
          repositoryRoot: "/repo",
          worktrees: [
            {
              path: "/repo",
              head: "0123456789abcdef",
              branch: "main",
              isMain: true,
              detached: false,
              locked: false,
              dirtyCount: 0
            },
            {
              path: "/repo-worktrees/codex-feature",
              head: "0123456789abcdef",
              branch: "codex/feature",
              isMain: false,
              detached: false,
              locked: false,
              dirtyCount: 0
            }
          ],
          commits: [{
            hash: "0123456789abcdef",
            parents: [],
            author: "Developer",
            email: "dev@example.com",
            date: new Date().toISOString(),
            subject: "Initial commit",
            refs: ["HEAD -> main", "origin/main"]
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

    expect(app.innerHTML).toContain("New task");
    expect(app.innerHTML).toContain("Codex agent");
    expect(app.innerHTML).toContain('id="new-worktree-target"');
    expect(app.innerHTML).toContain("New worktree");
    expect(app.innerHTML).toContain('id="new-workspace"');
    expect(app.innerHTML).toContain('id="new-branch-target"');
    expect(app.innerHTML).toContain("New branch");
    expect(app.innerHTML).toContain('id="new-base-branch"');
    expect(app.innerHTML).toContain('id="new-branch-name"');
    expect(app.innerHTML).toContain('id="unrestricted-access"');
    expect(app.innerHTML).toContain("Unrestricted");
    expect(app.innerHTML).toContain("Existing · stable");
    expect(app.innerHTML).toContain("already in a worktree");
    expect(app.innerHTML).toContain("Repository history");
    expect(app.innerHTML).toContain("repo");
    expect(app.innerHTML).toContain("codicon-folder");
    expect(script).toContain('icon: "diff-modified"');

    const preventDefault = vi.fn();
    worktreeRowHandlers.get("contextmenu")?.({
      preventDefault,
      clientX: 30,
      clientY: 40
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(app.innerHTML).toContain("Open in New Window");
    expect(app.innerHTML).toContain("New Agent Here");
    expect(app.innerHTML).toContain("Reveal in File Manager");
    expect(app.innerHTML).toContain("Copy Worktree Path");
    expect(app.innerHTML).toContain("Delete Worktree");
    expect(app.innerHTML).toContain("Delete this worktree; its branch will be kept");
    expect(app.innerHTML).not.toContain(">Cut<");
    expect(app.innerHTML).not.toContain(">Paste<");

    showHistoryHandlers.get("click")?.({
      currentTarget: showHistoryButton,
      target: showHistoryButton
    });
    expect(app.innerHTML).toContain("history-graph-canvas");
    expect(app.innerHTML).toContain('data-history-hash="0123456789abcdef"');
    expect(app.innerHTML).toContain('cy="17"');
    expect(app.innerHTML).toContain("Description");
    expect(app.innerHTML).toContain('class="commit-ref head"');
    expect(app.innerHTML).toContain('class="commit-ref-remote">origin');
    expect(app.innerHTML).toContain('class="history-row latest ');
  });
});
