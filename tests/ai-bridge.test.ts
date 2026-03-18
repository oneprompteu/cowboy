import { describe, it, expect } from "vitest";
import {
  buildHeadlessAgentCommand,
  buildInteractiveAgentCommand,
  buildSteerableClaudeCommand,
  parseClaudeStreamEvent,
} from "../src/core/ai-bridge.js";

describe("buildInteractiveAgentCommand", () => {
  it("builds a Claude interactive command without print-mode flags", () => {
    const [cmd, args] = buildInteractiveAgentCommand(
      "claude",
      "Create the skill",
      { addDirs: ["/tmp/library-repo"] },
    );

    expect(cmd).toBe("claude");
    expect(args).toEqual([
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
      { addDirs: ["/tmp/library-repo"] },
    );

    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "-s",
      "workspace-write",
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
      { addDirs: ["/tmp/library-repo"] },
    );

    expect(cmd).toBe("claude");
    expect(args).toEqual([
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
      { addDirs: ["/tmp/library-repo"] },
    );

    expect(cmd).toBe("codex");
    expect(args).toEqual([
      "exec",
      "--full-auto",
      "-s",
      "workspace-write",
      "--skip-git-repo-check",
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
    });

    expect(cmd).toBe("claude");
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
