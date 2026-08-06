import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendAttachmentContext,
  MAX_ATTACHMENT_BYTES,
  prepareAttachments
} from "../src/attachments";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "local-agent-attachments-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("prompt attachments", () => {
  it("uses workspace files in place", async () => {
    const workspace = await temporaryDirectory();
    const source = join(workspace, "notes.txt");
    await writeFile(source, "hello");

    const prepared = await prepareAttachments(workspace, [{
      name: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      sourcePath: source
    }]);

    expect(prepared.attachments).toEqual([{
      name: "notes.txt",
      path: source,
      mimeType: "text/plain",
      size: 5
    }]);
    expect(appendAttachmentContext("Review this", workspace, prepared.attachments))
      .toContain('- "notes.txt" (text/plain)');
    await prepared.cleanup();
    await expect(access(source)).resolves.toBeUndefined();
  });

  it("stages data in a git-ignored directory and removes it after the run", async () => {
    const workspace = await temporaryDirectory();
    await execFileAsync("git", ["-C", workspace, "init", "-q"]);
    const prepared = await prepareAttachments(workspace, [{
      name: "screen.png",
      mimeType: "image/png",
      size: 4,
      data: Buffer.from("image").toString("base64")
    }]);
    const attachment = prepared.attachments[0]!;

    expect(await readFile(attachment.path, "utf8")).toBe("image");
    const { stdout } = await execFileAsync("git", [
      "-C", workspace, "status", "--porcelain", "--untracked-files=all"
    ]);
    expect(stdout).toBe("");

    await prepared.cleanup();
    await expect(access(attachment.path)).rejects.toThrow();
  });

  it("rejects oversized and invalid encoded payloads", async () => {
    const workspace = await temporaryDirectory();
    await expect(prepareAttachments(workspace, [{
      name: "large.bin",
      mimeType: "application/octet-stream",
      size: MAX_ATTACHMENT_BYTES + 1,
      data: ""
    }])).rejects.toThrow("20 MB limit");
    await expect(prepareAttachments(workspace, [{
      name: "bad.bin",
      mimeType: "application/octet-stream",
      size: 2,
      data: "not base64"
    }])).rejects.toThrow("invalid encoded content");
  });
});
