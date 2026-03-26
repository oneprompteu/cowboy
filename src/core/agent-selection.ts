import { getConfiguredAgents } from "./config.js";
import { detectAgentTypes } from "./detector.js";
import type { AgentType } from "./schemas.js";

export function parseAgentSelection(values: string[]): AgentType[] {
  const parsed: AgentType[] = [];

  for (const value of values) {
    for (const token of value.split(",")) {
      const normalized = token.trim();
      if (!normalized) continue;

      if (normalized === "claude" || normalized === "claude-code") {
        parsed.push("claude");
        continue;
      }

      if (normalized === "codex") {
        parsed.push("codex");
        continue;
      }

      throw new Error(
        `Unknown agent "${normalized}". Use "claude" or "codex".`,
      );
    }
  }

  return Array.from(new Set(parsed));
}

export async function resolveInstallAgents(
  projectDir: string,
  requestedAgents: string[] = [],
): Promise<AgentType[]> {
  const configuredAgents = await getConfiguredAgents(projectDir);
  const availableAgents = configuredAgents.length > 0
    ? configuredAgents
    : await detectAgentTypes(projectDir);

  if (availableAgents.length === 0) {
    throw new Error("No agents detected. Run 'cowboy init' first.");
  }

  const requested = parseAgentSelection(requestedAgents);
  if (requested.length === 0) {
    return availableAgents;
  }

  for (const agent of requested) {
    if (!availableAgents.includes(agent)) {
      throw new Error(
        `Agent "${agent}" is not configured in this project.`,
      );
    }
  }

  return requested;
}
