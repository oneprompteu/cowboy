import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  AgentType,
  ScannedSkill,
  ImportedSkill,
  GeneratedSkill,
  SkillSource,
} from "./schemas.js";
import type { AgentAdapter, InstallResult } from "./adapters/base.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { CodexAdapter } from "./adapters/codex.js";
import { addSkill, removeSkill, findSkill } from "./tracker.js";

const adapters: Record<AgentType, AgentAdapter> = {
  claude: new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
};

export function getAdapter(agentType: AgentType): AgentAdapter {
  return adapters[agentType];
}

export interface InstallOptions {
  /** The scanned skill to install */
  skill: ScannedSkill;
  /** The project directory to install into */
  projectDir: string;
  /** Which agents to install for */
  agents: AgentType[];
  /** The GitHub repo URL this skill came from */
  sourceRepo: string;
}

/**
 * Install a skill into a project for the specified agents.
 * Writes skill files via adapters and tracks in .cowboy/installed.yaml.
 */
export async function installSkill(
  options: InstallOptions,
): Promise<InstallResult[]> {
  const { skill, projectDir, agents, sourceRepo } = options;
  const results: InstallResult[] = [];

  for (const agentType of agents) {
    const adapter = adapters[agentType];
    const result = await adapter.install(skill, projectDir);
    results.push(result);
  }

  const installed: ImportedSkill = {
    name: skill.name,
    type: "imported",
    source_repo: sourceRepo,
    source_path: skill.relativePath,
    content_hash: hashSkill(skill),
    installed_at: new Date().toISOString().split("T")[0],
    installed_for: agents,
  };

  await addSkill(projectDir, installed);

  return results;
}

/**
 * Remove a skill from a project.
 * Removes files via adapters and removes from .cowboy/installed.yaml.
 */
export async function uninstallSkill(
  skillName: string,
  projectDir: string,
): Promise<boolean> {
  const skill = await findSkill(projectDir, skillName);
  if (!skill) return false;

  for (const agentType of skill.installed_for) {
    const adapter = adapters[agentType];
    await adapter.remove(skillName, projectDir);
  }

  if (skill.type === "generated") {
    await rm(join(projectDir, ".cowboy", "skills", skillName), {
      recursive: true,
      force: true,
    });
  }

  await removeSkill(projectDir, skillName);
  return true;
}

export interface GeneratedInstallOptions {
  /** The generated skill to install */
  skill: ScannedSkill;
  /** The project directory to install into */
  projectDir: string;
  /** Which agents to install for */
  agents: AgentType[];
  /** Source repositories with their commit hashes */
  sources?: SkillSource[];
  /** The free-text topic/query this skill was generated from */
  researchQuery?: string;
  /** Preserve original installation date when updating an existing skill */
  installedAt?: string;
  /** Override the last-updated date when needed */
  lastUpdated?: string;
}

/**
 * Install an AI-generated skill into a project.
 * Same file installation as imported, but tracked as "generated" in the registry.
 */
export async function installGeneratedSkill(
  options: GeneratedInstallOptions,
): Promise<InstallResult[]> {
  const {
    skill,
    projectDir,
    agents,
    sources,
    researchQuery,
    installedAt,
    lastUpdated,
  } = options;
  const results: InstallResult[] = [];

  if ((!sources || sources.length === 0) && !researchQuery) {
    throw new Error("Generated skills require sources or researchQuery.");
  }

  for (const agentType of agents) {
    const adapter = adapters[agentType];
    const result = await adapter.install(skill, projectDir);
    results.push(result);
  }

  const today = new Date().toISOString().split("T")[0];
  const installed: GeneratedSkill = {
    name: skill.name,
    type: "generated",
    sources: sources && sources.length > 0 ? sources : undefined,
    research_query: researchQuery,
    installed_at: installedAt ?? today,
    last_updated: lastUpdated ?? today,
    installed_for: agents,
  };

  await addSkill(projectDir, installed);
  return results;
}

/**
 * Hash the entire skill: SKILL.md content + all companion files.
 * This ensures updates detect changes in scripts, references, etc.
 */
function hashSkill(skill: ScannedSkill): string {
  const hash = createHash("sha256");
  hash.update(skill.rawContent);

  if (skill.files) {
    for (const file of skill.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      hash.update(file.relativePath);
      hash.update(file.content);
    }
  }

  return `sha256:${hash.digest("hex").substring(0, 12)}`;
}
