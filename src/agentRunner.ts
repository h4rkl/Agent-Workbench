import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";
import type { OutputChannel } from "vscode";
import { AgentEventParser } from "./agentEvents";
import type {
  AgentEvent,
  PermissionMode,
  RunOutcome,
  RunRequest,
  RunningAgent
} from "./types";

function codexPermissionArgs(permission: PermissionMode): string[] {
  if (permission === "full-access") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  const sandbox = permission === "workspace-write" ? "workspace-write" : "read-only";
  return [
    "-c",
    'approval_policy="never"',
    "-c",
    `sandbox_mode="${sandbox}"`
  ];
}

function claudePermissionArgs(permission: PermissionMode): string[] {
  if (permission === "full-access") {
    return ["--dangerously-skip-permissions"];
  }
  if (permission === "plan") {
    return ["--permission-mode", "plan"];
  }
  if (permission === "read-only") {
    return [
      "--permission-mode",
      "dontAsk",
      "--disallowed-tools",
      "Edit,Write,NotebookEdit,Bash"
    ];
  }
  return ["--permission-mode", "acceptEdits"];
}

function buildCodexArgs(request: RunRequest): string[] {
  const { session } = request;
  const common = ["--json", ...codexPermissionArgs(session.permission)];
  if (session.model) {
    common.push("--model", session.model);
  }

  if (session.nativeSessionId) {
    return [
      "exec",
      "resume",
      ...common,
      session.nativeSessionId,
      "-"
    ];
  }

  return [
    "exec",
    ...common,
    "--cd",
    session.workspace,
    "--skip-git-repo-check",
    "-"
  ];
}

function buildClaudeArgs(request: RunRequest): string[] {
  const { session } = request;
  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    ...claudePermissionArgs(session.permission)
  ];

  if (session.model) {
    args.push("--model", session.model);
  }
  if (session.nativeSessionId) {
    args.push("--resume", session.nativeSessionId);
  } else {
    args.push("--session-id", session.id);
  }
  return args;
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.killed) {
    return;
  }
  child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 3_000);
  timeout.unref();
}

export class AgentRunner {
  public constructor(private readonly output: OutputChannel) {}

  public run(
    request: RunRequest,
    onEvent: (event: AgentEvent) => void
  ): RunningAgent {
    const args =
      request.session.provider === "claude"
        ? buildClaudeArgs(request)
        : buildCodexArgs(request);
    const env = { ...process.env };
    if (request.session.provider === "claude") {
      env.CLAUDE_CONFIG_DIR = request.userDirectory;
    } else {
      env.CODEX_HOME = request.userDirectory;
    }

    this.output.appendLine(
      `[${request.session.provider}] ${request.executable} ${args
        .map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg))
        .join(" ")}`
    );

    const child = spawn(request.executable, args, {
      cwd: request.session.workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const parser = new AgentEventParser(request.session.provider);
    let cancelled = false;
    let nativeSessionId = request.session.nativeSessionId;
    let finalText = "";
    let stderr = "";

    const outputLines = readline.createInterface({ input: child.stdout });
    outputLines.on("line", (line) => {
      this.output.appendLine(`[${request.session.provider}:stdout] ${line}`);
      for (const event of parser.parse(line)) {
        if (event.type === "native-session") {
          nativeSessionId = event.sessionId;
        } else if (event.type === "assistant") {
          finalText += event.text;
        } else if (event.type === "assistant-delta") {
          finalText += event.text;
        }
        onEvent(event);
      }
    });

    const errorLines = readline.createInterface({ input: child.stderr });
    errorLines.on("line", (line) => {
      stderr += `${line}\n`;
      this.output.appendLine(`[${request.session.provider}:stderr] ${line}`);
      onEvent({ type: "status", text: line });
    });

    child.stdin.on("error", (error) => {
      this.output.appendLine(`[${request.session.provider}:stdin] ${error.message}`);
    });
    child.stdin.end(request.prompt);

    const done = new Promise<RunOutcome>((resolve) => {
      child.once("error", (error) => {
        onEvent({ type: "error", message: error.message });
        resolve({
          exitCode: null,
          cancelled,
          nativeSessionId,
          finalText
        });
      });
      child.once("close", (exitCode) => {
        outputLines.close();
        errorLines.close();
        if (!cancelled && exitCode !== 0) {
          onEvent({
            type: "error",
            message: stderr.trim() || `${request.session.provider} exited with code ${exitCode}`
          });
        }
        resolve({ exitCode, cancelled, nativeSessionId, finalText });
      });
    });

    return {
      done,
      cancel: () => {
        cancelled = true;
        terminate(child);
      }
    };
  }
}
