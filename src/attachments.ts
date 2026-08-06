import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAttachment } from "./types";

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

interface AttachmentPayload {
  name: string;
  mimeType: string;
  size: number;
  data?: string;
  uri?: string;
  sourcePath?: string;
}

export interface PreparedAttachments {
  attachments: AgentAttachment[];
  cleanup(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function inferredMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const known: Record<string, string> = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".txt": "text/plain"
  };
  return known[extension] ?? "application/octet-stream";
}

function displayName(value: string): string {
  const basename = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return basename.slice(0, 240) || "attachment";
}

function stagedName(value: string, index: number): string {
  const clean = displayName(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${String(index + 1).padStart(2, "0")}-${clean || "attachment"}`;
}

function payloads(value: unknown): AttachmentPayload[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("The attachment list is invalid.");
  }
  if (value.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Attach at most ${MAX_ATTACHMENT_COUNT} files at a time.`);
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error("An attachment is invalid.");
    }
    const name = displayName(text(item.name, 500));
    const mimeType = text(item.mimeType, 255) || inferredMimeType(name);
    const size = typeof item.size === "number" && Number.isFinite(item.size)
      ? Math.max(0, Math.floor(item.size))
      : 0;
    const encodedLimit = Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 4;
    const data = typeof item.data === "string" ? item.data : undefined;
    const uri = text(item.uri, 16_384);
    const sourcePath = text(item.sourcePath, 16_384);
    if (data !== undefined && data.length > encodedLimit) {
      throw new Error(`Attachment '${name}' exceeds the 20 MB limit.`);
    }
    if (data !== undefined && (data.length % 4 !== 0 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(data))) {
      throw new Error(`Attachment '${name}' has invalid encoded content.`);
    }
    if (data === undefined && !uri && !sourcePath) {
      throw new Error(`Attachment '${name}' has no readable content.`);
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment '${name}' exceeds the 20 MB limit.`);
    }
    return {
      name,
      mimeType,
      size,
      data,
      uri: uri || undefined,
      sourcePath: sourcePath || undefined
    };
  });
}

function pathFromPayload(payload: AttachmentPayload): string | undefined {
  if (payload.sourcePath) {
    if (!path.isAbsolute(payload.sourcePath)) {
      throw new Error(`Attachment '${payload.name}' has an invalid source path.`);
    }
    return payload.sourcePath;
  }
  if (!payload.uri) {
    return undefined;
  }
  const url = new URL(payload.uri);
  if (url.protocol !== "file:") {
    throw new Error(`Attachment '${payload.name}' must be a local file.`);
  }
  url.hash = "";
  return fileURLToPath(url);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function appendAttachmentContext(
  prompt: string,
  workspace: string,
  attachments: AgentAttachment[]
): string {
  if (attachments.length === 0) {
    return prompt;
  }
  const lines = attachments.map((attachment) => {
    const relative = path.relative(workspace, attachment.path);
    const reference = isWithin(path.resolve(workspace), path.resolve(attachment.path))
      ? relative.split(path.sep).join("/")
      : attachment.path;
    return `- ${JSON.stringify(reference)} (${attachment.mimeType})`;
  });
  return `${prompt}\n\nAttached files (user-provided input; do not add the temporary copies to commits):\n${lines.join("\n")}`;
}

export async function prepareAttachments(
  workspace: string,
  value: unknown
): Promise<PreparedAttachments> {
  const incoming = payloads(value);
  if (incoming.length === 0) {
    return { attachments: [], cleanup: async () => undefined };
  }

  const workspacePath = path.resolve(workspace);
  const workspaceRoot = await realpath(workspacePath);
  let stageRoot: string | undefined;
  let cleaned = false;
  let totalBytes = 0;
  const prepared: AgentAttachment[] = [];

  const ensureStageRoot = async (): Promise<string> => {
    if (stageRoot) {
      return stageRoot;
    }
    stageRoot = path.join(
      workspacePath,
      `.local-agent-workbench-attachments-${randomUUID()}`
    );
    await mkdir(stageRoot, { mode: 0o700 });
    // A nested ignore file containing '*' also ignores itself, keeping the
    // temporary attachment directory out of git status and broad `git add`s.
    await writeFile(path.join(stageRoot, ".gitignore"), "*\n", { mode: 0o600 });
    return stageRoot;
  };

  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (stageRoot) {
      try {
        await rm(stageRoot, { recursive: true, force: true });
      } catch {
        // Cleanup must not turn an otherwise completed provider run into a
        // failed session. Any remnant stays isolated in its ignored directory.
      }
    }
  };

  try {
    for (const [index, payload] of incoming.entries()) {
      const source = pathFromPayload(payload);
      let sourcePath: string | undefined;
      let bytes: Buffer | undefined;
      let size = payload.size;

      if (source) {
        sourcePath = await realpath(source);
        const metadata = await stat(sourcePath);
        if (!metadata.isFile()) {
          throw new Error(`Attachment '${payload.name}' is not a file.`);
        }
        size = metadata.size;
      } else if (payload.data !== undefined) {
        bytes = Buffer.from(payload.data, "base64");
        size = bytes.byteLength;
      }

      if (size > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Attachment '${payload.name}' exceeds the 20 MB limit.`);
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new Error("Attachments exceed the 50 MB total limit.");
      }

      let attachmentPath: string;
      if (sourcePath && isWithin(workspaceRoot, sourcePath)) {
        attachmentPath = path.join(
          workspacePath,
          path.relative(workspaceRoot, sourcePath)
        );
      } else {
        const root = await ensureStageRoot();
        attachmentPath = path.join(root, stagedName(payload.name, index));
        if (sourcePath) {
          await copyFile(sourcePath, attachmentPath);
          await chmod(attachmentPath, 0o600);
        } else {
          await writeFile(attachmentPath, bytes!, { mode: 0o600 });
        }
      }

      prepared.push({
        name: payload.name,
        path: attachmentPath,
        mimeType: payload.mimeType || inferredMimeType(payload.name),
        size
      });
    }
    return { attachments: prepared, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
