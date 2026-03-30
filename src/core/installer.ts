import type {
  AgentType,
  GeneratedSkill,
  ImportedSkill,
  InstalledSkill,
  ScannedSkill,
  SkillSource,
} from "./schemas.js";
import type { AgentAdapter, InstallResult } from "./adapters/base.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { CodexAdapter } from "./adapters/codex.js";
import {
  ensureProjectCanonicalLink,
  loadGlobalCanonicalSkill,
  removeGlobalSkillFiles,
  removeProjectCanonicalLink,
  writeGlobalCanonicalSkill,
} from "./global-storage.js";
import {
  addSkill,
  findGlobalSkill,
  findSkill,
  readGlobalRegistry,
  readRegistry,
  removeGlobalSkillEntry,
  removeSkill,
} from "./tracker.js";
import { hashSkill } from "./skill-hash.js";

const adapters: Record<AgentType, AgentAdapter> = {
  claude: new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
};

export function getAdapter(agentType: AgentType): AgentAdapter {
  return adapters[agentType];
}

export interface InstallOptions {
  skill: ScannedSkill;
  projectDir: string;
  agents: AgentType[];
  sourceRepo: string;
}

export async function installSkill(
  options: InstallOptions,
): Promise<InstallResult[]> {
  const { skill, projectDir, agents, sourceRepo } = options;
  const results: InstallResult[] = [];

  await writeGlobalCanonicalSkill(skill);
  await ensureProjectCanonicalLink(projectDir, skill.name);

  for (const agentType of agents) {
    const adapter = adapters[agentType];
    results.push(await adapter.install(skill, projectDir));
  }

  const installed: ImportedSkill = {
    name: skill.name,
    type: "imported",
    source_repo: sourceRepo,
    source_path: skill.relativePath,
    content_hash: hashSkill(skill),
    installed_at: new Date().toISOString().split("T")[0],
    installed_for: agents,
    disabled_for: [],
  };

  await addSkill(projectDir, installed);
  return results;
}

export interface GeneratedInstallOptions {
  skill: ScannedSkill;
  projectDir: string;
  agents: AgentType[];
  sources?: SkillSource[];
  docUrls?: string[];
  researchQuery?: string;
  installedAt?: string;
  lastUpdated?: string;
}

export async function installGeneratedSkill(
  options: GeneratedInstallOptions,
): Promise<InstallResult[]> {
  const {
    skill,
    projectDir,
    agents,
    sources,
    docUrls,
    researchQuery,
    installedAt,
    lastUpdated,
  } = options;

  if ((!sources || sources.length === 0) && (!docUrls || docUrls.length === 0) && !researchQuery) {
    throw new Error("Generated skills require sources, docUrls, or researchQuery.");
  }

  const results: InstallResult[] = [];
  await writeGlobalCanonicalSkill(skill);
  await ensureProjectCanonicalLink(projectDir, skill.name);

  for (const agentType of agents) {
    const adapter = adapters[agentType];
    results.push(await adapter.install(skill, projectDir));
  }

  const today = new Date().toISOString().split("T")[0];
  const installed: GeneratedSkill = {
    name: skill.name,
    type: "generated",
    sources: sources && sources.length > 0 ? sources : undefined,
    doc_urls: docUrls && docUrls.length > 0 ? docUrls : undefined,
    research_query: researchQuery,
    installed_at: installedAt ?? today,
    last_updated: lastUpdated ?? today,
    installed_for: agents,
    disabled_for: [],
  };

  await addSkill(projectDir, installed);
  return results;
}

export async function addGlobalSkillToProject(
  skillName: string,
  projectDir: string,
  agents: AgentType[],
): Promise<InstallResult[]> {
  const globalSkill = await findGlobalSkill(skillName);
  if (!globalSkill) {
    throw new Error(`Skill "${skillName}" is not in the global Cowboy library.`);
  }

  const canonical = await loadGlobalCanonicalSkill(skillName);
  if (!canonical) {
    throw new Error(`Global skill "${skillName}" is missing its canonical files.`);
  }

  await ensureProjectCanonicalLink(projectDir, skillName);
  const existing = await findSkill(projectDir, skillName);
  const nextInstalledFor = Array.from(new Set([
    ...(existing?.installed_for ?? []),
    ...agents,
  ]));
  const nextDisabled = (existing?.disabled_for ?? []).filter((agent) => !agents.includes(agent));

  const results: InstallResult[] = [];
  for (const agentType of agents) {
    const adapter = adapters[agentType];
    results.push(await adapter.install(canonical, projectDir));
  }

  await addSkill(projectDir, mergeWithProjectState(globalSkill, nextInstalledFor, nextDisabled));
  return results;
}

export async function uninstallSkill(
  skillName: string,
  projectDir: string,
): Promise<boolean> {
  const skill = await findSkill(projectDir, skillName);
  if (!skill) return false;

  for (const agentType of skill.installed_for) {
    await adapters[agentType].remove(skillName, projectDir);
  }

  await removeProjectCanonicalLink(projectDir, skillName);
  await removeSkill(projectDir, skillName);
  return true;
}

export async function removeGlobalSkill(
  skillName: string,
  options?: { force?: boolean },
): Promise<void> {
  const globalSkill = await findGlobalSkill(skillName);
  if (!globalSkill) {
    throw new Error(`Skill "${skillName}" was not found in the global Cowboy library.`);
  }

  const linkedProjects = [...globalSkill.linked_projects];
  if (linkedProjects.length > 0 && !options?.force) {
    throw new Error(
      `Skill "${skillName}" is still linked in ${linkedProjects.length} project(s). Use --force to remove it globally.`,
    );
  }

  for (const linkedProject of linkedProjects) {
    const linkedSkill = await findSkill(linkedProject, skillName);
    if (!linkedSkill) {
      continue;
    }

    for (const agentType of linkedSkill.installed_for) {
      await adapters[agentType].remove(skillName, linkedProject);
    }

    await removeProjectCanonicalLink(linkedProject, skillName);
    await removeSkill(linkedProject, skillName);
  }

  await removeGlobalSkillFiles(skillName);
  await removeGlobalSkillEntry(skillName);
}

export async function disableSkill(
  skillName: string,
  projectDir: string,
  agent?: AgentType,
): Promise<InstalledSkill | null> {
  const skill = await findSkill(projectDir, skillName);
  if (!skill) return null;

  const toDisable = agent ? [agent] : skill.installed_for;

  for (const currentAgent of toDisable) {
    if (!skill.installed_for.includes(currentAgent)) continue;
    if (skill.disabled_for.includes(currentAgent)) continue;
    await adapters[currentAgent].remove(skillName, projectDir);
  }

  const disabled = new Set(skill.disabled_for);
  for (const currentAgent of toDisable) {
    if (skill.installed_for.includes(currentAgent)) {
      disabled.add(currentAgent);
    }
  }

  const updated: InstalledSkill = {
    ...skill,
    disabled_for: [...disabled],
  };
  await addSkill(projectDir, updated);
  return updated;
}

export async function enableSkill(
  skillName: string,
  projectDir: string,
  agent?: AgentType,
): Promise<InstalledSkill | null> {
  const skill = await findSkill(projectDir, skillName);
  if (!skill) return null;

  const toEnable = agent ? [agent] : [...skill.disabled_for];
  if (toEnable.length === 0) return skill;

  const canonical = await loadGlobalCanonicalSkill(skillName);
  if (!canonical) {
    throw new Error(
      `Cannot enable "${skillName}": global canonical copy was not found.`,
    );
  }

  await ensureProjectCanonicalLink(projectDir, skillName);

  for (const currentAgent of toEnable) {
    if (!skill.installed_for.includes(currentAgent)) continue;
    if (!skill.disabled_for.includes(currentAgent)) continue;
    await adapters[currentAgent].install(canonical, projectDir);
  }

  const updated: InstalledSkill = {
    ...skill,
    disabled_for: skill.disabled_for.filter((currentAgent) => !toEnable.includes(currentAgent)),
  };
  await addSkill(projectDir, updated);
  return updated;
}

export async function getLinkedProjects(skillName: string): Promise<string[]> {
  const globalRegistry = await readGlobalRegistry();
  return globalRegistry.skills.find((skill) => skill.name === skillName)?.linked_projects ?? [];
}

function mergeWithProjectState(
  globalSkill: Awaited<ReturnType<typeof findGlobalSkill>> extends infer T
    ? NonNullable<T>
    : never,
  installedFor: AgentType[],
  disabledFor: AgentType[],
): InstalledSkill {
  if (globalSkill.type === "imported") {
    return {
      type: "imported",
      name: globalSkill.name,
      installed_at: globalSkill.installed_at,
      source_repo: globalSkill.source_repo,
      source_path: globalSkill.source_path,
      content_hash: globalSkill.content_hash,
      installed_for: installedFor,
      disabled_for: disabledFor,
    };
  }

  return {
    type: "generated",
    name: globalSkill.name,
    installed_at: globalSkill.installed_at,
    sources: globalSkill.sources,
    doc_urls: globalSkill.doc_urls,
    research_query: globalSkill.research_query,
    last_updated: globalSkill.last_updated,
    installed_for: installedFor,
    disabled_for: disabledFor,
  };
}
