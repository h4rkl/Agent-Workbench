# Local Agent Workbench

A Copilot-free VS Code workbench for running your installed **Claude Code**,
**OpenAI Codex CLI**, and **Grok Build** agents. It presents an Agents-style,
full-editor interface while launching the real local CLIs with their existing
user directories, credentials, configuration, rules, skills, and session
history.

The extension does not sign in to GitHub Copilot and does not proxy prompts
through a VS Code chat provider.

## What is included

- A worktree-first three-pane editor for launching parallel agents on isolated
  Git branches
- A unified **New agent in…** launcher for choosing an existing or new
  worktree independently from an existing, current, or new branch
- Worktree status, running-agent activity, repository-wide commit history, and
  commit file inspection in one view, with native-style Codicon diff markers
- Resizable side panes, compact/comfortable density, and a configurable accent
  color
- Direct adapters for Claude stream JSON, `codex exec --json`, and Grok
  `streaming-json`
- New and resumed sessions for all three providers
- Import from `~/.claude/projects`, `~/.codex/sessions`, and `~/.grok/sessions`,
  or custom user dirs
- Model and permission selection per session
- Live response streaming, tool cards, cancellation, CLI health, and raw logs
- Git status with click-to-open diffs, lazy workspace browsing, and an
  Agents-style history graph across every ref
- One-click worktree opening in a separate VS Code window
- Editor-selection context for targeted file-and-line feedback to an agent
- Local session metadata persisted with mode `0600`
- A status-bar toggle, editor-title toggle, command-palette commands, and
  `Cmd+Alt+A` / `Ctrl+Alt+A`
- A focused launch layout that hides VS Code's sidebars and non-terminal panel
  while preserving an existing terminal
- A detach action that moves the workbench editor into its own VS Code window

## Requirements

- VS Code 1.104 or newer
- Node.js 24 for building the extension (see `.nvmrc`)
- At least one installed and authenticated CLI:

```bash
claude --version
codex --version
grok --version
```

Authentication stays owned by each CLI. Complete `claude`, `codex`, or
`grok login` in a terminal before starting a workbench session if the relevant
CLI is not already authenticated.

## Build and install

The repository is intended to live at `~/Sites/vs-code-agent`.

```bash
cd ~/Sites/vs-code-agent
pnpm install
pnpm run package
code --install-extension ./local-agent-workbench-0.1.0.vsix --force
```

Reload VS Code after installation. If the `code` shell command is unavailable,
open **Extensions: Install from VSIX…** from the Command Palette and choose
`local-agent-workbench-0.1.0.vsix`.

`pnpm run package` performs the typecheck, unit tests, production build, and VSIX
packaging. For a faster unpackaged build:

```bash
pnpm run check
```

## Development

Open this directory in VS Code:

```bash
cd ~/Sites/vs-code-agent
code .
pnpm install
```

Press `F5` to launch an Extension Development Host. The launch task starts the
esbuild watcher automatically. In the development window, run **Local Agents:
Open Workbench**.

Individual scripts:

```bash
pnpm run watch       # rebuild extension host code on changes
pnpm run typecheck   # strict TypeScript check
pnpm run check:ui    # syntax-check the webview runtime
pnpm test            # JSONL adapter tests
pnpm run build       # production extension bundle
pnpm run package     # verified .vsix package
```

The webview assets under `media/` are loaded directly, so reload the Extension
Development Host after changing the workbench JavaScript or CSS.

## Use

1. Click **Local Agents** in the status bar, use the sparkle button in the
   editor title, or run **Local Agents: Toggle Workbench**.
2. Choose **New task** and use the **New [agent] in [worktree]** controls to
   select Claude, Codex, or Grok and either an existing worktree or a new one.
   Choose the current branch, an available existing branch, or a new branch
   from any local base. Blank branch names become `agent/<task>-<timestamp>` names.
   New worktrees live in a sibling `<repository>-worktrees` directory.
   **Commit result** asks the agent to verify and commit its intended changes.
3. Launch additional agents the same way. The left pane shows every worktree,
   dirty-file count, and running agents. Use **New agent here** when follow-up
   work should continue on an existing worktree; choose **New branch** there to
   branch in place. The worktree must be clean before its branch is changed.
4. Open **Repository history** to inspect commits across all branches. Select a
   commit to see its changed files, open native before/after diffs, or jump to
   the corresponding file in the selected worktree.
5. Select a worktree and use **Open in VS Code** to work in it directly. Select
   lines in an editor and use the composer’s **+** button to attach those exact
   lines to targeted agent feedback.
6. Use `Cmd+Enter` on macOS or `Ctrl+Enter` elsewhere to submit a prompt.

Use **Import local history** to scan the configured CLI user directories. An
imported session keeps its native session ID, so the next prompt resumes it
through the owning CLI.

## Configuration

Open Settings and search for `Local Agent Workbench`.

| Setting                                     | Default           | Purpose                                           |
| ------------------------------------------- | ----------------- | ------------------------------------------------- |
| `localAgentWorkbench.claude.executable`     | `claude`          | Executable name or absolute path                  |
| `localAgentWorkbench.claude.userDirectory`  | `~/.claude`       | Claude authentication, settings, and history      |
| `localAgentWorkbench.claude.defaultModel`   | empty             | Model/alias passed to Claude                      |
| `localAgentWorkbench.codex.executable`      | `codex`           | Executable name or absolute path                  |
| `localAgentWorkbench.codex.userDirectory`   | `~/.codex`        | `CODEX_HOME`, including auth, config, and history |
| `localAgentWorkbench.codex.defaultModel`    | empty             | Model passed to Codex                             |
| `localAgentWorkbench.grok.executable`       | `grok`            | Grok Build executable name or absolute path       |
| `localAgentWorkbench.grok.userDirectory`    | `~/.grok`         | `GROK_HOME`, including auth, config, and history  |
| `localAgentWorkbench.grok.defaultModel`     | empty             | Model or alias passed to Grok Build               |
| `localAgentWorkbench.dataDirectory`         | `~/.vscode-agent` | Workbench metadata location                       |
| `localAgentWorkbench.defaultProvider`       | `claude`          | Provider preselected for new sessions             |
| `localAgentWorkbench.defaultPermission`     | `workspace-write` | Initial access boundary                           |
| `localAgentWorkbench.showStatusBarButton`   | `true`            | Show/hide the status-bar toggle                   |
| `localAgentWorkbench.appearance.accent`     | `#8b5cf6`         | Workbench accent CSS color                        |
| `localAgentWorkbench.appearance.density`    | `comfortable`     | Compact or comfortable UI                         |
| `localAgentWorkbench.discovery.maxSessions` | `200`             | Maximum native sessions to scan                   |

Paths beginning with `~` are expanded. Executables are resolved from `PATH`
plus common local macOS locations, including `~/.grok/bin` and NVM
installations.

### Using separate user directories

To use a non-default profile, point the relevant setting at it:

```json
{
  "localAgentWorkbench.claude.userDirectory": "~/.claude-work",
  "localAgentWorkbench.codex.userDirectory": "~/.codex-work",
  "localAgentWorkbench.grok.userDirectory": "~/.grok-work"
}
```

The extension starts Claude with `CLAUDE_CONFIG_DIR` and Codex with
`CODEX_HOME`, and Grok with `GROK_HOME`, so each provider loads that profile
directly.

## Permission behavior

| Workbench mode | Codex                          | Claude Code                                           | Grok Build                              |
| -------------- | ------------------------------ | ----------------------------------------------------- | --------------------------------------- |
| Plan           | Read-only Codex sandbox        | `plan` permission mode                                | `plan` with read-only sandbox           |
| Read only      | Read-only Codex sandbox        | `dontAsk`, with edit/write/notebook/Bash tools denied | `dontAsk` with read-only sandbox        |
| Workspace      | Workspace-write Codex sandbox  | `acceptEdits` permission mode                         | Auto-approve with workspace sandbox     |
| Unrestricted   | Bypasses approvals and sandbox | Skips permission checks                               | Auto-approve with sandbox disabled      |

Claude Code does not expose a Codex-equivalent filesystem sandbox. Its
`acceptEdits` boundary is therefore governed by Claude's permission system and
your Claude settings; treat it differently from Codex's OS sandbox.
Grok locks its sandbox profile for the life of a native session, so resumed
sessions restore the profile selected when they were created.
Unrestricted access is intentionally guarded by a modal confirmation per workspace.

The extension also asks you to trust a workspace before its first agent run.

## Storage and privacy

- Workbench session metadata is stored in
  `~/.vscode-agent/sessions.json` by default.
- Native Claude, Codex, and Grok transcripts remain in their provider-owned user
  directories. Removing a session from the workbench does not delete them.
- Prompts and output pass between the webview, the extension host, and the local
  CLI process. The extension itself has no telemetry or network client.
- The provider CLIs may make network requests according to their own
  configuration and terms.
- Raw JSONL and stderr are available in **Output: Local Agent Workbench** for
  troubleshooting.

## Architecture

```text
Custom editor webview
  ├─ worktree/agent orchestration
  ├─ repository history graph and commit inspection
  ├─ workspace files, changes, and editor-selection context
  └─ VS Code message bridge
       ├─ local metadata store (~/.vscode-agent)
       ├─ native history discovery (~/.claude, ~/.codex, ~/.grok)
       ├─ Git worktree/status/history integration
       └─ child process adapter
            ├─ claude --print --output-format stream-json
            ├─ codex exec --json
            └─ grok --prompt-file … --output-format streaming-json
```

No shell is used to launch provider processes; arguments are passed directly to
the executable.

## Supported-surface limitation

VS Code does not provide a public extension API for injecting arbitrary local
providers into the first-party Copilot **New Agent Session** dropdown or for
copying the private **Open in Agents** implementation. This extension supplies
an independent custom editor built with supported webview and Git APIs. It is
similar in workflow, but does not modify VS Code internals or require Copilot.

Provider JSONL formats can evolve. If a CLI update stops rendering an event,
check **Local Agents: Check CLI Installations** and the output channel, then add
a fixture to `test/agentEvents.test.ts` before updating the parser.

## License

Apache License 2.0. This project is independent of Microsoft, Anthropic, OpenAI,
and xAI. Product names belong to their respective owners.
