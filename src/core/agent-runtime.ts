import { readCowboyConfig } from "./config.js";
import type {
  AgentType,
  ClaudeEffort,
  CodexReasoningEffort,
} from "./schemas.js";

export interface AgentRuntimeOverrides {
  claudeModel?: string;
  effort?: string;
}

export interface AgentRuntimeOptions {
  model?: string;
  effort?: string;
}

export const CLAUDE_MODEL_CHOICES = [
  { label: "CLI default", value: "default" },
  { label: "sonnet", value: "sonnet" },
  { label: "opus", value: "opus" },
] as const;

export const CLAUDE_EFFORT_CHOICES = [
  { label: "CLI default", value: "default" },
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "max (Opus 4.6 only)", value: "max" },
] as const;

export const CODEX_EFFORT_CHOICES = [
  { label: "CLI default", value: "default" },
  { label: "none", value: "none" },
  { label: "minimal", value: "minimal" },
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "xhigh", value: "xhigh" },
] as const;

const CLAUDE_EFFORTS = new Set<ClaudeEffort>(["low", "medium", "high", "max"]);
const CODEX_EFFORTS = new Set<CodexReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export async function resolveAgentRuntimeOptions(
  projectDir: string,
  agent: AgentType,
  overrides: AgentRuntimeOverrides = {},
): Promise<AgentRuntimeOptions> {
  const config = await readCowboyConfig(projectDir);

  if (agent === "claude") {
    const model = overrides.claudeModel?.trim()
      || config?.generation_defaults?.claude?.model;
    const effort = overrides.effort?.trim()
      || config?.generation_defaults?.claude?.effort;

    if (effort && !CLAUDE_EFFORTS.has(effort as ClaudeEffort)) {
      throw new Error(
        `Invalid Claude effort "${effort}". Use low, medium, high, or max.`,
      );
    }

    return {
      model: model || undefined,
      effort: effort || undefined,
    };
  }

  if (overrides.claudeModel?.trim()) {
    throw new Error("--claude-model can only be used when the selected agent is claude.");
  }

  const effort = overrides.effort?.trim()
    || config?.generation_defaults?.codex?.effort;

  if (effort && !CODEX_EFFORTS.has(effort as CodexReasoningEffort)) {
    throw new Error(
      `Invalid Codex effort "${effort}". Use none, minimal, low, medium, high, or xhigh.`,
    );
  }

  return {
    effort: effort || undefined,
  };
}
