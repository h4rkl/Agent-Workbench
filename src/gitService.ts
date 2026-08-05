import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { WorkspaceChange } from "./types";

const execFileAsync = promisify(execFile);

function normalizeStatus(status: string): string {
  if (status === "??") {
    return "U";
  }
  const trimmed = status.trim();
  return trimmed || "M";
}

export class GitService {
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
