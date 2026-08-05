import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function nvmCandidates(executable: string): Promise<string[]> {
  const versionsRoot = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    const versions = await readdir(versionsRoot, { withFileTypes: true });
    return versions
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsRoot, entry.name, "bin", executable))
      .reverse();
  } catch {
    return [];
  }
}

export async function resolveExecutable(configured: string): Promise<string> {
  const expanded = configured.startsWith("~/")
    ? path.join(os.homedir(), configured.slice(2))
    : configured;

  if (path.isAbsolute(expanded) || expanded.includes(path.sep)) {
    if (await isExecutable(expanded)) {
      return expanded;
    }
    throw new Error(`Executable is not available: ${expanded}`);
  }

  const pathCandidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, expanded));

  const commonCandidates = [
    path.join(os.homedir(), ".local", "bin", expanded),
    path.join(os.homedir(), "bin", expanded),
    path.join("/opt/homebrew/bin", expanded),
    path.join("/usr/local/bin", expanded),
    ...(await nvmCandidates(expanded))
  ];

  for (const candidate of [...pathCandidates, ...commonCandidates]) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find '${configured}'. Configure an absolute path in Local Agent Workbench settings.`
  );
}
