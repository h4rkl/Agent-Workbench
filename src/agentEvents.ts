import type { AgentEvent, AgentProvider } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function renderUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function textFromClaudeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      const item = recordValue(block);
      if (!item || item.type !== "text") {
        return "";
      }
      return stringValue(item.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function claudeToolEvents(content: unknown): AgentEvent[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const events: AgentEvent[] = [];
  for (const block of content) {
    const item = recordValue(block);
    if (!item || item.type !== "tool_use") {
      continue;
    }
    const name = stringValue(item.name) ?? "Tool";
    events.push({
      type: "tool",
      id: stringValue(item.id) ?? `${name}-${events.length}`,
      title: name,
      content: renderUnknown(item.input ?? {}),
      state: "running"
    });
  }
  return events;
}

function codexToolEvent(
  item: JsonRecord,
  eventType: string
): AgentEvent | undefined {
  const itemType = stringValue(item.type) ?? "tool";
  const id = stringValue(item.id) ?? stringValue(item.call_id) ?? itemType;
  const state =
    eventType === "item.started"
      ? "running"
      : item.status === "failed" || item.status === "error"
        ? "failed"
        : "completed";

  if (itemType === "command_execution") {
    const command = stringValue(item.command) ?? "Command";
    const output = stringValue(item.aggregated_output) ?? "";
    return {
      type: "tool",
      id,
      title: command,
      content: output || command,
      state
    };
  }

  if (itemType === "file_change") {
    return {
      type: "tool",
      id,
      title: "File changes",
      content: renderUnknown(item.changes ?? item),
      state
    };
  }

  if (itemType === "mcp_tool_call") {
    const server = stringValue(item.server) ?? "MCP";
    const tool = stringValue(item.tool) ?? stringValue(item.name) ?? "tool";
    return {
      type: "tool",
      id,
      title: `${server} · ${tool}`,
      content: renderUnknown(item.arguments ?? item.result ?? item),
      state
    };
  }

  if (itemType === "web_search") {
    return {
      type: "tool",
      id,
      title: "Web search",
      content: stringValue(item.query) ?? renderUnknown(item),
      state
    };
  }

  if (itemType === "plan") {
    return {
      type: "tool",
      id,
      title: "Plan",
      content: renderUnknown(item.items ?? item.text ?? item),
      state
    };
  }

  return undefined;
}

function grokToolState(value: unknown, fallback: AgentEvent & { type: "tool" }): "running" | "completed" | "failed" {
  return value === "failed" || value === "error"
    ? "failed"
    : value === "completed"
      ? "completed"
      : fallback.state;
}

export class AgentEventParser {
  private sawClaudeTextDelta = false;
  private emittedClaudeText = false;
  private readonly grokTools = new Map<string, AgentEvent & { type: "tool" }>();

  public constructor(private readonly provider: AgentProvider) {}

  public parse(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    let event: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isRecord(parsed)) {
        return [{ type: "status", text: trimmed }];
      }
      event = parsed;
    } catch {
      return [{ type: "status", text: trimmed }];
    }

    return this.provider === "claude"
      ? this.parseClaude(event)
      : this.provider === "grok"
        ? this.parseGrok(event)
        : this.parseCodex(event);
  }

  private parseClaude(event: JsonRecord): AgentEvent[] {
    const type = stringValue(event.type) ?? "";
    const events: AgentEvent[] = [];

    if (type === "system" && event.subtype === "init") {
      const sessionId = stringValue(event.session_id);
      if (sessionId) {
        events.push({ type: "native-session", sessionId });
      }
      events.push({ type: "status", text: "Claude session initialized" });
      return events;
    }

    if (type === "stream_event") {
      const streamEvent = recordValue(event.event);
      const delta = recordValue(streamEvent?.delta);
      if (streamEvent?.type === "content_block_delta" && delta) {
        if (delta.type === "text_delta") {
          const text = stringValue(delta.text);
          if (text) {
            this.sawClaudeTextDelta = true;
            this.emittedClaudeText = true;
            events.push({ type: "assistant-delta", text });
          }
        } else if (delta.type === "thinking_delta") {
          const thinking = stringValue(delta.thinking);
          if (thinking) {
            events.push({ type: "reasoning-delta", text: thinking });
          }
        }
      }
      return events;
    }

    if (type === "assistant") {
      const message = recordValue(event.message);
      const content = message?.content;
      events.push(...claudeToolEvents(content));
      if (!this.sawClaudeTextDelta) {
        const text = textFromClaudeContent(content);
        if (text) {
          this.emittedClaudeText = true;
          events.push({ type: "assistant", text });
        }
      }
      return events;
    }

    if (type === "result") {
      const sessionId = stringValue(event.session_id);
      if (sessionId) {
        events.push({ type: "native-session", sessionId });
      }
      const result = stringValue(event.result);
      if (result && !this.emittedClaudeText) {
        this.emittedClaudeText = true;
        events.push({ type: "assistant", text: result });
      }
      const usage = recordValue(event.usage);
      if (usage) {
        events.push({ type: "usage", usage });
      }
      if (event.is_error === true) {
        events.push({ type: "error", message: result ?? "Claude run failed" });
      }
      return events;
    }

    return events;
  }

  private parseCodex(event: JsonRecord): AgentEvent[] {
    const type = stringValue(event.type) ?? "";

    if (type === "thread.started") {
      const sessionId = stringValue(event.thread_id);
      return sessionId
        ? [
            { type: "native-session", sessionId },
            { type: "status", text: "Codex thread initialized" }
          ]
        : [];
    }

    if (type === "turn.started") {
      return [{ type: "status", text: "Codex is working" }];
    }

    if (type === "turn.completed") {
      const usage = recordValue(event.usage);
      return usage ? [{ type: "usage", usage }] : [];
    }

    if (type === "turn.failed" || type === "error") {
      const error = recordValue(event.error);
      const message =
        stringValue(event.message) ??
        stringValue(error?.message) ??
        "Codex run failed";
      return [{ type: "error", message }];
    }

    if (type === "item.started" || type === "item.completed") {
      const item = recordValue(event.item);
      if (!item) {
        return [];
      }
      if (item.type === "agent_message" && type === "item.completed") {
        const text = stringValue(item.text);
        return text ? [{ type: "assistant", text }] : [];
      }
      if (item.type === "reasoning" && type === "item.completed") {
        const text = stringValue(item.text);
        return text ? [{ type: "reasoning-delta", text }] : [];
      }
      const tool = codexToolEvent(item, type);
      return tool ? [tool] : [];
    }

    return [];
  }

  private parseGrok(event: JsonRecord): AgentEvent[] {
    const type = stringValue(event.type) ?? "";
    if (type === "text") {
      const text = stringValue(event.data);
      return text ? [{ type: "assistant-delta", text }] : [];
    }
    if (type === "thought") {
      const text = stringValue(event.data);
      return text ? [{ type: "reasoning-delta", text }] : [];
    }
    if (type === "tool_call") {
      const id = stringValue(event.toolCallId) ?? "grok-tool";
      const tool: AgentEvent & { type: "tool" } = {
        type: "tool",
        id,
        title: stringValue(event.title) ?? stringValue(event.toolName) ?? "Tool",
        content: renderUnknown(event.rawInput ?? event.content ?? {}),
        state: "running"
      };
      tool.state = grokToolState(event.status, tool);
      this.grokTools.set(id, tool);
      return [tool];
    }
    if (type === "tool_call_update") {
      const id = stringValue(event.toolCallId) ?? "grok-tool";
      const previous = this.grokTools.get(id) ?? {
        type: "tool" as const,
        id,
        title: stringValue(event.title) ?? "Tool",
        content: "",
        state: "running" as const
      };
      const tool: AgentEvent & { type: "tool" } = {
        ...previous,
        title: stringValue(event.title) ?? previous.title,
        content: renderUnknown(event.rawOutput ?? event.content ?? previous.content),
        state: grokToolState(event.status, previous)
      };
      this.grokTools.set(id, tool);
      return [tool];
    }
    if (type === "usage") {
      const usage = recordValue(event.usage);
      return usage ? [{ type: "usage", usage }] : [];
    }
    if (type === "plan") {
      return [{
        type: "tool",
        id: "grok-plan",
        title: "Plan",
        content: renderUnknown(event.entries ?? []),
        state: "completed"
      }];
    }
    if (type === "end") {
      const events: AgentEvent[] = [];
      const sessionId = stringValue(event.sessionId);
      if (sessionId) {
        events.push({ type: "native-session", sessionId });
      }
      const usage = recordValue(event.usage);
      if (usage) {
        events.push({ type: "usage", usage });
      }
      return events;
    }
    if (type === "error") {
      return [{ type: "error", message: stringValue(event.message) ?? "Grok run failed" }];
    }
    if (type === "max_turns_reached") {
      return [{ type: "status", text: "Grok reached the maximum number of turns" }];
    }
    return [];
  }
}
