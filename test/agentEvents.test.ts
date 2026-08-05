import { describe, expect, it } from "vitest";
import { AgentEventParser } from "../src/agentEvents";

describe("AgentEventParser", () => {
  it("normalizes Claude streaming text without duplicating the final message", () => {
    const parser = new AgentEventParser("claude");

    expect(
      parser.parse(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "claude-session"
        })
      )
    ).toEqual([
      { type: "native-session", sessionId: "claude-session" },
      { type: "status", text: "Claude session initialized" }
    ]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hello" }
          }
        })
      )
    ).toEqual([{ type: "assistant-delta", text: "Hello" }]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] }
        })
      )
    ).toEqual([]);
  });

  it("normalizes Claude thinking, tools, usage, and errors", () => {
    const parser = new AgentEventParser("claude");

    expect(
      parser.parse(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "Inspecting files" }
          }
        })
      )
    ).toEqual([{ type: "reasoning-delta", text: "Inspecting files" }]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tool-1",
                name: "Read",
                input: { file_path: "README.md" }
              }
            ]
          }
        })
      )
    ).toEqual([
      {
        type: "tool",
        id: "tool-1",
        title: "Read",
        content: '{\n  "file_path": "README.md"\n}',
        state: "running"
      }
    ]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "result",
          session_id: "claude-session",
          result: "Permission denied",
          is_error: true,
          usage: { input_tokens: 10 }
        })
      )
    ).toEqual([
      { type: "native-session", sessionId: "claude-session" },
      { type: "assistant", text: "Permission denied" },
      { type: "usage", usage: { input_tokens: 10 } },
      { type: "error", message: "Permission denied" }
    ]);
  });

  it("normalizes Codex thread, message, command, and usage events", () => {
    const parser = new AgentEventParser("codex");

    expect(
      parser.parse(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }))
    ).toEqual([
      { type: "native-session", sessionId: "thread-1" },
      { type: "status", text: "Codex thread initialized" }
    ]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "item.started",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "npm test"
          }
        })
      )
    ).toEqual([
      {
        type: "tool",
        id: "command-1",
        title: "npm test",
        content: "npm test",
        state: "running"
      }
    ]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "item.completed",
          item: { id: "message-1", type: "agent_message", text: "Done" }
        })
      )
    ).toEqual([{ type: "assistant", text: "Done" }]);

    expect(
      parser.parse(
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 20, output_tokens: 4 }
        })
      )
    ).toEqual([
      { type: "usage", usage: { input_tokens: 20, output_tokens: 4 } }
    ]);
  });

  it("turns non-JSON output into a status update", () => {
    const parser = new AgentEventParser("codex");
    expect(parser.parse("warming up")).toEqual([
      { type: "status", text: "warming up" }
    ]);
  });
});
