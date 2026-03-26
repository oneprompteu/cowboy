import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  InstalledRegistrySchema,
  type InstalledRegistry,
  type InstalledSkill,
} from "./schemas.js";

const COWBOY_DIR = ".cowboy";
const INSTALLED_FILE = "installed.yaml";

/**
 * Read the installed skills registry from a project.
 * Returns empty registry if file doesn't exist.
 */
export async function readRegistry(
  projectDir: string,
): Promise<InstalledRegistry> {
  const filePath = join(projectDir, COWBOY_DIR, INSTALLED_FILE);

  try {
    const content = await readFile(filePath, "utf-8");
    const data = yamlParse(content);
    return InstalledRegistrySchema.parse(data ?? {});
  } catch {
    return { skills: [] };
  }
}

/**
 * Write the installed skills registry to a project.
 */
export async function writeRegistry(
  projectDir: string,
  registry: InstalledRegistry,
): Promise<void> {
  const dir = join(projectDir, COWBOY_DIR);
  const filePath = join(dir, INSTALLED_FILE);

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, yamlStringify(registry), "utf-8");
}

/**
 * Add a skill to the registry. Replaces if same name exists.
 */
export async function addSkill(
  projectDir: string,
  skill: InstalledSkill,
): Promise<void> {
  const registry = await readRegistry(projectDir);
  registry.skills = registry.skills.filter((s) => s.name !== skill.name);
  registry.skills.push(skill);
  await writeRegistry(projectDir, registry);
}

/**
 * Remove a skill from the registry by name.
 */
export async function removeSkill(
  projectDir: string,
  skillName: string,
): Promise<boolean> {
  const registry = await readRegistry(projectDir);
  const before = registry.skills.length;
  registry.skills = registry.skills.filter((s) => s.name !== skillName);

  if (registry.skills.length === before) {
    return false; // Skill not found
  }

  await writeRegistry(projectDir, registry);
  return true;
}

/**
 * Find a skill in the registry by name.
 */
export async function findSkill(
  projectDir: string,
  skillName: string,
): Promise<InstalledSkill | undefined> {
  const registry = await readRegistry(projectDir);
  return registry.skills.find((s) => s.name === skillName);
}
