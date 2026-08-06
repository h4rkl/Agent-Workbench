import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {},
  window: {},
  Uri: { file: (value: string) => value },
  commands: { executeCommand: vi.fn() }
}));

import { GitService } from "../src/gitService";

const execFileAsync = promisify(execFile);

describe("GitService worktree orchestration", () => {
  let repository = "";
  let worktreesDirectory = "";

  beforeEach(async () => {
    repository = await mkdtemp(join(tmpdir(), "local-agent-workbench-git-"));
    worktreesDirectory = join(dirname(repository), `${basename(repository)}-worktrees`);
    await execFileAsync("git", ["init", "-b", "main", repository]);
    await execFileAsync("git", ["-C", repository, "config", "user.name", "Agent Test"]);
    await execFileAsync("git", ["-C", repository, "config", "user.email", "agent@example.com"]);
    await writeFile(join(repository, "README.md"), "initial\n", "utf8");
    await execFileAsync("git", ["-C", repository, "add", "README.md"]);
    await execFileAsync("git", ["-C", repository, "commit", "-m", "initial commit"]);
  });

  afterEach(async () => {
    await rm(repository, { recursive: true, force: true });
    await rm(worktreesDirectory, { recursive: true, force: true });
  });

  it("creates and discovers worktrees with repository history", async () => {
    const service = new GitService();
    const created = await service.createWorktree(repository, "Implement focused review");
    const worktrees = await service.listWorktrees(repository);
    const history = await service.listHistory(repository);
    const canonicalRepository = await realpath(repository);
    const canonicalWorktree = await realpath(created.workspace);

    expect(created.branch).toMatch(/^agent\/implement-focused-review-/);
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({ path: canonicalRepository, branch: "main", isMain: true });
    expect(worktrees[1]).toMatchObject({ path: canonicalWorktree, branch: created.branch });
    expect(history[0]).toMatchObject({ subject: "initial commit", author: "Agent Test" });
  });

  it("creates a custom branch from the selected base branch", async () => {
    const service = new GitService();
    await execFileAsync("git", ["-C", repository, "branch", "stable"]);
    const { stdout: stableHead } = await execFileAsync(
      "git",
      ["-C", repository, "rev-parse", "stable"],
      { encoding: "utf8" }
    );
    await writeFile(join(repository, "README.md"), "main moved\n", "utf8");
    await execFileAsync("git", ["-C", repository, "add", "README.md"]);
    await execFileAsync("git", ["-C", repository, "commit", "-m", "advance main"]);

    const created = await service.createWorktree(repository, "Custom task", {
      baseBranch: "stable",
      branchName: "codex/fix-breakpoint-default-locale"
    });
    const branches = await service.listBranches(repository);
    const { stdout: worktreeHead } = await execFileAsync(
      "git",
      ["-C", created.workspace, "rev-parse", "HEAD"],
      { encoding: "utf8" }
    );

    expect(created.branch).toBe("codex/fix-breakpoint-default-locale");
    expect(branches).toContain(created.branch);
    expect(worktreeHead.trim()).toBe(stableHead.trim());
    await expect(service.createWorktree(repository, "Duplicate", {
      baseBranch: "main",
      branchName: created.branch
    })).rejects.toThrow(`Branch already exists: ${created.branch}`);
  });

  it("creates a worktree on an existing branch", async () => {
    const service = new GitService();
    await execFileAsync("git", ["-C", repository, "branch", "stable"]);

    const created = await service.createWorktree(repository, "Use stable", {
      baseBranch: "stable",
      createBranch: false
    });
    const worktrees = await service.listWorktrees(repository);

    expect(created.branch).toBe("stable");
    expect(worktrees).toHaveLength(2);
    expect(worktrees[1]).toMatchObject({ branch: "stable" });
    await expect(service.createWorktree(repository, "Duplicate stable", {
      baseBranch: "stable",
      createBranch: false
    })).rejects.toThrow("Branch stable is already checked out");
  });

  it("removes a clean linked worktree without deleting its branch", async () => {
    const service = new GitService();
    const created = await service.createWorktree(repository, "Disposable task", {
      branchName: "codex/disposable-task"
    });

    await service.removeWorktree(repository, created.workspace);

    await expect(service.listWorktrees(repository)).resolves.toEqual([
      expect.objectContaining({ branch: "main", isMain: true })
    ]);
    await expect(service.listBranches(repository)).resolves.toContain(created.branch);
    await expect(service.removeWorktree(repository, repository))
      .rejects.toThrow("primary worktree cannot be deleted");
  });

  it("refuses to remove a worktree with uncommitted changes", async () => {
    const service = new GitService();
    const created = await service.createWorktree(repository, "Keep local changes");
    await writeFile(join(created.workspace, "notes.txt"), "keep me\n", "utf8");

    await expect(service.removeWorktree(repository, created.workspace))
      .rejects.toThrow("Commit, stash, or discard");
    await expect(service.listWorktrees(repository)).resolves.toHaveLength(2);
  });

  it("creates a new branch inside a clean existing worktree", async () => {
    const service = new GitService();
    const created = await service.createBranch(repository, "Continue here", {
      baseBranch: "main",
      branchName: "agent/continue-here"
    });

    expect(created).toEqual({ workspace: repository, branch: "agent/continue-here" });
    await expect(service.currentBranch(repository)).resolves.toBe("agent/continue-here");

    await writeFile(join(repository, "README.md"), "uncommitted\n", "utf8");
    await expect(service.createBranch(repository, "Unsafe switch"))
      .rejects.toThrow("Commit or stash this worktree's changes");
  });

  it("reports changes and reads files from a commit", async () => {
    const service = new GitService();
    await writeFile(join(repository, "README.md"), "changed\n", "utf8");

    const changes = await service.listChanges(repository);
    const history = await service.listHistory(repository);
    const content = await service.fileAtCommit(repository, history[0]!.hash, "README.md");
    const files = await service.commitFiles(repository, history[0]!.hash);

    expect(changes).toEqual([
      expect.objectContaining({ path: "README.md", status: "M" })
    ]);
    expect(content).toBe("initial\n");
    expect(files).toEqual([
      expect.objectContaining({ path: "README.md", additions: 1, deletions: 0, status: "A" })
    ]);

    await execFileAsync("git", ["-C", repository, "add", "README.md"]);
    await execFileAsync("git", ["-C", repository, "commit", "-m", "update readme"]);
    const updatedHistory = await service.listHistory(repository);
    const updatedHash = updatedHistory[0]!.hash;

    await expect(service.fileAtRevision(repository, `${updatedHash}^`, "README.md"))
      .resolves.toBe("initial\n");
    await expect(service.fileAtCommit(repository, updatedHash, "README.md"))
      .resolves.toBe("changed\n");
    await expect(service.commitFiles(repository, updatedHash))
      .resolves.toEqual([
        expect.objectContaining({ path: "README.md", status: "M" })
      ]);
  });
});
