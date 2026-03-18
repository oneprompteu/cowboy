import { access } from "node:fs/promises";
import { join } from "node:path";
import type { AgentType } from "./schemas.js";

interface AgentDetection {
  type: AgentType;
  /** The directory marker that was found */
  marker: string;
}

/**
 * Detect which AI coding agents are configured in a project directory.
 * Looks for known marker directories/files.
 */
export async function detectAgents(
  projectDir: string,
): Promise<AgentDetection[]> {
  const checks: Array<{ type: AgentType; paths: string[] }> = [
    {
      type: "claude",
      paths: [".claude"],
    },
    {
      type: "codex",
      paths: [".agents"],
    },
  ];

  const detected: AgentDetection[] = [];

  for (const check of checks) {
    for (const markerPath of check.paths) {
      const fullPath = join(projectDir, markerPath);
      if (await exists(fullPath)) {
        detected.push({ type: check.type, marker: markerPath });
        break; // One match per agent type is enough
      }
    }
  }

  return detected;
}

/**
 * Get just the agent type strings detected in a project.
 */
export async function detectAgentTypes(
  projectDir: string,
): Promise<AgentType[]> {
  const detections = await detectAgents(projectDir);
  return detections.map((d) => d.type);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
