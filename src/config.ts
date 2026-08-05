import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  AgentProvider,
  PermissionMode,
  WorkbenchConfigSnapshot
} from "./types";

const SECTION = "localAgentWorkbench";

export function expandHome(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export function getConfigSnapshot(): WorkbenchConfigSnapshot {
  const config = vscode.workspace.getConfiguration(SECTION);
  const defaultProvider = config.get<AgentProvider>("defaultProvider", "claude");
  const defaultPermission = config.get<PermissionMode>(
    "defaultPermission",
    "workspace-write"
  );

  return {
    accent: config.get<string>("appearance.accent", "#8b5cf6"),
    density: config.get<"compact" | "comfortable">(
      "appearance.density",
      "comfortable"
    ),
    defaultProvider,
    defaultPermission,
    defaultModels: {
      claude: config.get<string>("claude.defaultModel", ""),
      codex: config.get<string>("codex.defaultModel", "")
    },
    dataDirectory: expandHome(
      config.get<string>("dataDirectory", "~/.vscode-agent")
    ),
    userDirectories: {
      claude: expandHome(
        config.get<string>("claude.userDirectory", "~/.claude")
      ),
      codex: expandHome(config.get<string>("codex.userDirectory", "~/.codex"))
    },
    executableSettings: {
      claude: config.get<string>("claude.executable", "claude"),
      codex: config.get<string>("codex.executable", "codex")
    }
  };
}

export function getMaxDiscoveredSessions(): number {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<number>("discovery.maxSessions", 200);
}

export function shouldShowStatusBarButton(): boolean {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<boolean>("showStatusBarButton", true);
}
