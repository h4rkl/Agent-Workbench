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

  it("normalizes Grok streaming text, reasoning, tools, usage, and session metadata", () => {
    const parser = new AgentEventParser("grok");

    expect(parser.parse(JSON.stringify({ type: "text", data: "Implemented" })))
      .toEqual([{ type: "assistant-delta", text: "Implemented" }]);
    expect(parser.parse(JSON.stringify({ type: "thought", data: "Checking tests" })))
      .toEqual([{ type: "reasoning-delta", text: "Checking tests" }]);
    expect(parser.parse(JSON.stringify({
      type: "tool_call",
      toolCallId: "tool-1",
      title: "Run tests",
      toolName: "run_terminal_cmd",
      status: "in_progress",
      rawInput: { command: "npm test" }
    }))).toEqual([{
      type: "tool",
      id: "tool-1",
      title: "Run tests",
      content: '{\n  "command": "npm test"\n}',
      state: "running"
    }]);
    expect(parser.parse(JSON.stringify({
      type: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      rawOutput: { exitCode: 0 }
    }))).toEqual([{
      type: "tool",
      id: "tool-1",
      title: "Run tests",
      content: '{\n  "exitCode": 0\n}',
      state: "completed"
    }]);
    expect(parser.parse(JSON.stringify({
      type: "end",
      sessionId: "grok-session",
      usage: { input_tokens: 30, output_tokens: 8 }
    }))).toEqual([
      { type: "native-session", sessionId: "grok-session" },
      { type: "usage", usage: { input_tokens: 30, output_tokens: 8 } }
    ]);
  });
});
