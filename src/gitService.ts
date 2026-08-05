import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type {
  GitCommit,
  GitCommitFile,
  WorkspaceChange,
  WorktreeInfo
} from "./types";

const execFileAsync = promisify(execFile);

function normalizeStatus(status: string): string {
  if (status === "??") {
    return "U";
  }
  const trimmed = status.trim();
  return trimmed || "M";
}

export class GitService {
  public async repositoryRoot(workspace: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", workspace, "rev-parse", "--show-toplevel"],
        { encoding: "utf8" }
      );
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  public async listWorktrees(workspace: string): Promise<WorktreeInfo[]> {
    const root = await this.repositoryRoot(workspace);
    if (!root) {
      return [];
    }
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "worktree", "list", "--porcelain"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    const records = stdout.trim().split(/\n\s*\n/).filter(Boolean);
    const worktrees = await Promise.all(records.map(async (record, index) => {
      const fields = new Map<string, string>();
      let detached = false;
      let locked = false;
      for (const line of record.split("\n")) {
        const separator = line.indexOf(" ");
        const key = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? "" : line.slice(separator + 1);
        fields.set(key, value);
        detached ||= key === "detached";
        locked ||= key === "locked";
      }
      const worktreePath = fields.get("worktree") || root;
      const changes = await this.listChanges(worktreePath);
      return {
        path: worktreePath,
        head: fields.get("HEAD") || "",
        branch: (fields.get("branch") || "").replace(/^refs\/heads\//, "") || "detached",
        isMain: index === 0,
        detached,
        locked,
        dirtyCount: changes.length
      } satisfies WorktreeInfo;
    }));
    return worktrees;
  }

  public async listHistory(workspace: string, limit = 200): Promise<GitCommit[]> {
    const root = await this.repositoryRoot(workspace);
    if (!root) {
      return [];
    }
    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "-C",
          root,
          "log",
          "--all",
          `--max-count=${limit}`,
          "--date=iso-strict",
          "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e"
        ],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
      );
      return stdout
        .split("\x1e")
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
          const [hash = "", parents = "", author = "", email = "", date = "", subject = "", refs = ""] = record.split("\x1f");
          return {
            hash,
            parents: parents.split(" ").filter(Boolean),
            author,
            email,
            date,
            subject,
            refs: refs.split(",").map((item) => item.trim()).filter(Boolean)
          } satisfies GitCommit;
        });
    } catch {
      return [];
    }
  }

  public async commitFiles(workspace: string, hash: string): Promise<GitCommitFile[]> {
    const root = await this.repositoryRoot(workspace);
    if (!root || !/^[a-f0-9]{7,64}$/i.test(hash)) {
      return [];
    }
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "show", "--format=", "--numstat", "--no-renames", hash],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    );
    return stdout.split("\n").map((line) => {
      const [added, deleted, ...fileParts] = line.split("\t");
      return {
        path: fileParts.join("\t"),
        additions: Number.parseInt(added || "0", 10) || 0,
        deletions: Number.parseInt(deleted || "0", 10) || 0
      };
    }).filter((file) => Boolean(file.path));
  }

  public async fileAtCommit(
    workspace: string,
    hash: string,
    relativePath: string
  ): Promise<string> {
    const root = await this.repositoryRoot(workspace);
    const normalizedPath = relativePath.replace(/\\/g, "/");
    if (
      !root ||
      !/^[a-f0-9]{7,64}$/i.test(hash) ||
      normalizedPath.startsWith("/") ||
      normalizedPath === ".." ||
      normalizedPath.startsWith("../")
    ) {
      throw new Error("Invalid commit file reference.");
    }
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "show", `${hash}:${normalizedPath}`],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    );
    return stdout;
  }

  public async currentBranch(workspace: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", workspace, "branch", "--show-current"],
        { encoding: "utf8" }
      );
      return stdout.trim();
    } catch {
      return "";
    }
  }

  public async createWorktree(
    workspace: string,
    title: string
  ): Promise<{ workspace: string; branch: string }> {
    const { stdout: repositoryOutput } = await execFileAsync(
      "git",
      ["-C", workspace, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" }
    );
    const { stdout: worktreeOutput } = await execFileAsync(
      "git",
      ["-C", workspace, "worktree", "list", "--porcelain"],
      { encoding: "utf8" }
    );
    const repository = worktreeOutput.match(/^worktree (.+)$/m)?.[1] || repositoryOutput.trim();
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "session";
    const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
    const directoryName = `${slug}-${suffix}`;
    const branch = `agent/${directoryName}`;
    const worktreesDirectory = path.join(
      path.dirname(repository),
      `${path.basename(repository)}-worktrees`
    );
    const target = path.join(worktreesDirectory, directoryName);
    await mkdir(worktreesDirectory, { recursive: true });
    await execFileAsync(
      "git",
      ["-C", repository, "worktree", "add", "-b", branch, target, "HEAD"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
    );
    return { workspace: target, branch };
  }

  public async listChanges(workspace: string): Promise<WorkspaceChange[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", workspace, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
      );
      const parts = stdout.split("\0").filter(Boolean);
      const changes: WorkspaceChange[] = [];
      for (let index = 0; index < parts.length; index += 1) {
        const entry = parts[index];
        if (!entry || entry.length < 4) {
          continue;
        }
        const rawStatus = entry.slice(0, 2);
        let filePath = entry.slice(3);
        if (rawStatus.includes("R") || rawStatus.includes("C")) {
          const original = parts[index + 1];
          index += original ? 1 : 0;
          filePath = filePath || original || filePath;
        }
        changes.push({
          path: filePath,
          status: normalizeStatus(rawStatus),
          staged: rawStatus[0] !== " " && rawStatus[0] !== "?",
          untracked: rawStatus === "??"
        });
      }
      return changes.sort((a, b) => a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  }

  public async openFile(workspace: string, relativePath: string): Promise<void> {
    const target = this.safePath(workspace, relativePath);
    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public async openDiff(workspace: string, relativePath: string): Promise<void> {
    const target = vscode.Uri.file(this.safePath(workspace, relativePath));
    try {
      await vscode.commands.executeCommand("git.openChange", target);
    } catch {
      await this.openFile(workspace, relativePath);
    }
  }

  private safePath(workspace: string, relativePath: string): string {
    const root = path.resolve(workspace);
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Refusing to open a path outside the selected workspace.");
    }
    return target;
  }
}
