import { describe, it, expect } from "vitest";
import {
  buildHeadlessAgentCommand,
  buildInteractiveAgentCommand,
  buildSteerableClaudeCommand,
  formatHeadlessSessionFooter,
  formatHeadlessSessionHeader,
  parseClaudeStreamEvent,
} from "../src/core/ai-bridge.js";

describe("buildInteractiveAgentCommand", () => {
  it("builds a Claude interactive command without print-mode flags", () => {
    const [cmd, args] = buildInteractiveAgentCommand(
      "claude",
      "Create the skill",
      { addDirs: ["/tmp/library-repo"], model: "sonnet", effort: "high" },
    );

    expect(cmd).toBe("claude");
    expect(args).toEqual([
      "--model",
      "sonnet",
      "--effort",
      "high",
      "Create the skill",
      "--add-dir",
      "/tmp/library-repo",
    ]);
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("stream-json");
    expect(args).not.toContain("--search");
  });

  it("builds a Codex interactive command without non-interactive flags", () => {
    const [cmd, args] = buildInteractiveAgentCommand(
      "codex",
      "Update the skill",
      { addDirs: ["/tmp/library-repo"], effort: "xhigh" },
    );

    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "-s",
      "workspace-write",
      "-c",
      'model_reasoning_effort="xhigh"',
      "--add-dir",
      "/tmp/library-repo",
      "Update the skill",
    ]);
    expect(args).not.toContain("-q");
    expect(args).not.toContain("--search");
  });

  it("does not add Codex search flags even when topic research is requested", () => {
    const [cmd, args] = buildInteractiveAgentCommand(
      "codex",
      "Research langchain and create a skill",
    );

    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "-s",
      "workspace-write",
      "Research langchain and create a skill",
    ]);
    expect(args).not.toContain("--search");
  });
});

describe("buildHeadlessAgentCommand", () => {
  it("builds a Claude headless command", () => {
    const [cmd, args] = buildHeadlessAgentCommand(
      "claude",
      "Create the skill",
      { addDirs: ["/tmp/library-repo"], model: "opus", effort: "max" },
    );

    expect(cmd).toBe("claude");
    expect(args).toEqual([
      "--model",
      "opus",
      "--effort",
      "max",
      "-p",
      "Create the skill",
      "--add-dir",
      "/tmp/library-repo",
    ]);
  });

  it("builds a Codex headless command without search flags", () => {
    const [cmd, args] = buildHeadlessAgentCommand(
      "codex",
      "Research langchain and create a skill",
      { addDirs: ["/tmp/library-repo"], effort: "minimal" },
    );

    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "exec",
      "--full-auto",
      "-s",
      "workspace-write",
      "--skip-git-repo-check",
      "-c",
      'model_reasoning_effort="minimal"',
      "--add-dir",
      "/tmp/library-repo",
      "Research langchain and create a skill",
    ]);
    expect(args).not.toContain("--search");
  });
});

describe("buildSteerableClaudeCommand", () => {
  it("includes stream-json flags for input and output", () => {
    const [cmd, args] = buildSteerableClaudeCommand({
      agent: "claude",
      cwd: "/tmp",
      prompt: "Create the skill",
      addDirs: ["/tmp/library-repo"],
      model: "sonnet",
      effort: "medium",
    });

    expect(cmd).toBe("claude");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--effort");
    expect(args).toContain("medium");
    expect(args).toContain("-p");
    expect(args).toContain("--input-format");
    expect(args).toContain("--output-format");
    expect(args.filter((a) => a === "stream-json")).toHaveLength(2);
    expect(args).toContain("--add-dir");
    expect(args).toContain("/tmp/library-repo");
  });

  it("works without addDirs", () => {
    const [, args] = buildSteerableClaudeCommand({
      agent: "claude",
      cwd: "/tmp",
      prompt: "Do something",
    });

    expect(args).not.toContain("--add-dir");
  });
});

describe("parseClaudeStreamEvent", () => {
  it("extracts text from assistant messages", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I'll create the skill." }],
      },
    });
    expect(parseClaudeStreamEvent(line)).toBe("I'll create the skill.");
  });

  it("formats tool_use events with file_path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/src/index.ts" } },
        ],
      },
    });
    expect(parseClaudeStreamEvent(line)).toBe("▸ Read /src/index.ts");
  });

  it("formats tool_use events with command", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ],
      },
    });
    expect(parseClaudeStreamEvent(line)).toBe("▸ Bash npm test");
  });

  it("returns null for result events", () => {
    const line = JSON.stringify({ type: "result", subtype: "success" });
    expect(parseClaudeStreamEvent(line)).toBeNull();
  });

  it("returns null for system events", () => {
    const line = JSON.stringify({ type: "system", subtype: "init" });
    expect(parseClaudeStreamEvent(line)).toBeNull();
  });

  it("returns null for empty lines", () => {
    expect(parseClaudeStreamEvent("")).toBeNull();
    expect(parseClaudeStreamEvent("  ")).toBeNull();
  });

  it("passes through non-JSON lines", () => {
    expect(parseClaudeStreamEvent("some plain text")).toBe("some plain text");
  });

  it("skips whitespace-only text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "   " }],
      },
    });
    expect(parseClaudeStreamEvent(line)).toBeNull();
  });
});

describe("headless session chrome", () => {
  it("shows steer-ready header for Claude interactive mode", () => {
    expect(
      formatHeadlessSessionHeader("claude", true, true),
    ).toBe("claude · steer ready");
  });

  it("shows read-only header when terminal interaction is unavailable", () => {
    expect(
      formatHeadlessSessionHeader("codex", false, false),
    ).toBe("codex · read-only");
  });

  it("renders steer controls when steering is available", () => {
    expect(
      formatHeadlessSessionFooter({
        agent: "claude",
        canInteract: true,
        canSteer: true,
        steeringMode: false,
        inputBuffer: "",
      }),
    ).toContain("[s] steer");
  });

  it("explains when steering is unavailable", () => {
    expect(
      formatHeadlessSessionFooter({
        agent: "codex",
        canInteract: true,
        canSteer: false,
        steeringMode: false,
        inputBuffer: "",
      }),
    ).toContain("steer available only with Claude");
  });

  it("renders steering composer text when steering mode is active", () => {
    expect(
      formatHeadlessSessionFooter({
        agent: "claude",
        canInteract: true,
        canSteer: true,
        steeringMode: true,
        inputBuffer: "focus on docs",
      }),
    ).toContain("focus on docs");
  });
});
