import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  GlobalRegistrySchema,
  InstalledRegistrySchema,
  InstalledSkillSchema,
  ProjectRegistrySchema,
  type GlobalInstalledSkill,
  type GlobalRegistry,
  type InstalledRegistry,
  type InstalledSkill,
  type ProjectInstalledSkill,
  type ProjectRegistry,
} from "./schemas.js";
import { ensureGlobalStorageDirs, getGlobalRegistryPath } from "./global-storage.js";

const COWBOY_DIR = ".cowboy";
const INSTALLED_FILE = "installed.yaml";

/**
 * Read the merged installed skills registry for a project.
 * The on-disk project registry stores attachment state only; this function
 * joins it with the global metadata registry so callers can keep using the
 * richer skill view.
 */
export async function readRegistry(
  projectDir: string,
): Promise<InstalledRegistry> {
  const legacyRegistry = await readLegacyRegistry(projectDir);
  if (legacyRegistry) {
    return legacyRegistry;
  }

  const [projectRegistry, globalRegistry] = await Promise.all([
    readProjectRegistry(projectDir),
    readGlobalRegistry(),
  ]);

  const skills = projectRegistry.skills
    .map((projectSkill) => mergeSkill(projectSkill, globalRegistry.skills))
    .filter((skill): skill is InstalledSkill => Boolean(skill));

  return { skills };
}

/**
 * Write a merged skill into project and global registries.
 */
export async function addSkill(
  projectDir: string,
  skill: InstalledSkill,
): Promise<void> {
  const projectPath = resolve(projectDir);
  const [projectRegistry, globalRegistry] = await Promise.all([
    readProjectRegistry(projectDir),
    readGlobalRegistry(),
  ]);

  const existingProjectSkill = projectRegistry.skills.find((entry) => entry.name === skill.name);
  const addedAt = existingProjectSkill?.added_at ?? new Date().toISOString().split("T")[0];

  const nextProjectSkill: ProjectInstalledSkill = {
    name: skill.name,
    added_at: addedAt,
    installed_for: [...skill.installed_for],
    disabled_for: [...skill.disabled_for],
  };

  const existingGlobalSkill = globalRegistry.skills.find((entry) => entry.name === skill.name);
  const nextGlobalSkill = toGlobalSkill(
    skill,
    existingGlobalSkill?.linked_projects ?? [],
    projectPath,
  );

  projectRegistry.skills = projectRegistry.skills.filter((entry) => entry.name !== skill.name);
  projectRegistry.skills.push(nextProjectSkill);

  globalRegistry.skills = globalRegistry.skills.filter((entry) => entry.name !== skill.name);
  globalRegistry.skills.push(nextGlobalSkill);

  await Promise.all([
    writeProjectRegistry(projectDir, projectRegistry),
    writeGlobalRegistry(globalRegistry),
  ]);
}

/**
 * Remove a skill from a project registry and unlink the project from the
 * global registry. The global skill package itself is preserved.
 */
export async function removeSkill(
  projectDir: string,
  skillName: string,
): Promise<boolean> {
  const projectPath = resolve(projectDir);
  const [projectRegistry, globalRegistry] = await Promise.all([
    readProjectRegistry(projectDir),
    readGlobalRegistry(),
  ]);

  const before = projectRegistry.skills.length;
  projectRegistry.skills = projectRegistry.skills.filter((entry) => entry.name !== skillName);

  if (projectRegistry.skills.length === before) {
    return false;
  }

  globalRegistry.skills = globalRegistry.skills.map((entry) => (
    entry.name !== skillName
      ? entry
      : {
          ...entry,
          linked_projects: entry.linked_projects.filter((path) => path !== projectPath),
        }
  ));

  await Promise.all([
    writeProjectRegistry(projectDir, projectRegistry),
    writeGlobalRegistry(globalRegistry),
  ]);

  return true;
}

/**
 * Find a merged skill view for a project by name.
 */
export async function findSkill(
  projectDir: string,
  skillName: string,
): Promise<InstalledSkill | undefined> {
  const registry = await readRegistry(projectDir);
  return registry.skills.find((skill) => skill.name === skillName);
}

export async function readProjectRegistry(
  projectDir: string,
): Promise<ProjectRegistry> {
  const filePath = join(projectDir, COWBOY_DIR, INSTALLED_FILE);

  try {
    const content = await readFile(filePath, "utf-8");
    return ProjectRegistrySchema.parse(yamlParse(content) ?? {});
  } catch {
    return { skills: [] };
  }
}

export async function writeProjectRegistry(
  projectDir: string,
  registry: ProjectRegistry,
): Promise<void> {
  const dir = join(projectDir, COWBOY_DIR);
  const filePath = join(dir, INSTALLED_FILE);

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, yamlStringify(registry), "utf-8");
}

export async function readGlobalRegistry(): Promise<GlobalRegistry> {
  const filePath = getGlobalRegistryPath();

  try {
    const content = await readFile(filePath, "utf-8");
    return GlobalRegistrySchema.parse(yamlParse(content) ?? {});
  } catch {
    return { skills: [] };
  }
}

export async function writeGlobalRegistry(
  registry: GlobalRegistry,
): Promise<void> {
  await ensureGlobalStorageDirs();
  const filePath = getGlobalRegistryPath();
  await writeFile(filePath, yamlStringify(registry), "utf-8");
}

export async function findGlobalSkill(
  skillName: string,
): Promise<GlobalInstalledSkill | undefined> {
  const registry = await readGlobalRegistry();
  return registry.skills.find((skill) => skill.name === skillName);
}

export async function removeGlobalSkillEntry(skillName: string): Promise<void> {
  const registry = await readGlobalRegistry();
  registry.skills = registry.skills.filter((skill) => skill.name !== skillName);
  await writeGlobalRegistry(registry);
}

function mergeSkill(
  projectSkill: ProjectInstalledSkill,
  globalSkills: GlobalInstalledSkill[],
): InstalledSkill | null {
  const globalSkill = globalSkills.find((entry) => entry.name === projectSkill.name);
  if (!globalSkill) {
    return null;
  }

  const merged = {
    ...globalSkill,
    installed_for: projectSkill.installed_for,
    disabled_for: projectSkill.disabled_for,
  };

  return InstalledSkillSchema.parse(merged);
}

function toGlobalSkill(
  skill: InstalledSkill,
  linkedProjects: string[],
  projectPath: string,
): GlobalInstalledSkill {
  const uniqueLinkedProjects = Array.from(new Set([...linkedProjects, projectPath]));

  if (skill.type === "imported") {
    return {
      type: "imported",
      name: skill.name,
      installed_at: skill.installed_at,
      source_repo: skill.source_repo,
      source_path: skill.source_path,
      content_hash: skill.content_hash,
      linked_projects: uniqueLinkedProjects,
    };
  }

  return {
    type: "generated",
    name: skill.name,
    installed_at: skill.installed_at,
    sources: skill.sources,
    doc_urls: skill.doc_urls,
    research_query: skill.research_query,
    last_updated: skill.last_updated,
    linked_projects: uniqueLinkedProjects,
  };
}

async function readLegacyRegistry(
  projectDir: string,
): Promise<InstalledRegistry | null> {
  const filePath = join(projectDir, COWBOY_DIR, INSTALLED_FILE);

  try {
    const content = await readFile(filePath, "utf-8");
    return InstalledRegistrySchema.parse(yamlParse(content) ?? {});
  } catch {
    return null;
  }
}
