import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { getAdapter } from "./installer.js";
import {
  ensureProjectCanonicalLink,
  getProjectSkillDir,
  loadGlobalCanonicalSkill,
  loadSkillPackageFromDir,
  writeGlobalCanonicalSkill,
} from "./global-storage.js";
import { addSkill, readRegistry } from "./tracker.js";
import { hashSkill } from "./skill-hash.js";
import { InstalledRegistrySchema, ProjectRegistrySchema, type InstalledSkill, type ScannedSkill } from "./schemas.js";

const INSTALLED_FILE = join(".cowboy", "installed.yaml");

export async function migrateProjectIfNeeded(projectDir: string): Promise<void> {
  const legacyRegistry = await readLegacyRegistry(projectDir);

  if (legacyRegistry) {
    for (const skill of legacyRegistry.skills) {
      const canonical = await loadLegacyCanonicalSkill(projectDir, skill.name);
      if (!canonical) {
        throw new Error(
          `Cannot migrate "${skill.name}": no canonical files were found in the project or installed agent directories.`,
        );
      }

      await assertNoGlobalConflict(skill.name, canonical);
      if (!await loadGlobalCanonicalSkill(skill.name)) {
        await writeGlobalCanonicalSkill(canonical);
      }

      await addSkill(projectDir, skill);
      await ensureProjectCanonicalLink(projectDir, skill.name);

      const activeAgents = skill.installed_for.filter((agent) => !skill.disabled_for.includes(agent));
      for (const agent of activeAgents) {
        await getAdapter(agent).install(canonical, projectDir);
      }
    }

    return;
  }

  const registry = await readRegistry(projectDir);
  for (const skill of registry.skills) {
    const canonical = await loadGlobalCanonicalSkill(skill.name);
    if (!canonical) {
      continue;
    }

    await ensureProjectCanonicalLink(projectDir, skill.name);
    const activeAgents = skill.installed_for.filter((agent) => !skill.disabled_for.includes(agent));
    for (const agent of activeAgents) {
      await getAdapter(agent).install(canonical, projectDir);
    }
  }
}

async function readLegacyRegistry(projectDir: string) {
  const filePath = join(projectDir, INSTALLED_FILE);

  let parsed: unknown;
  try {
    const raw = await readFile(filePath, "utf-8");
    parsed = yamlParse(raw) ?? {};
  } catch {
    return null;
  }

  const isNewRegistry = ProjectRegistrySchema.safeParse(parsed).success;
  if (isNewRegistry) {
    return null;
  }

  const legacy = InstalledRegistrySchema.safeParse(parsed);
  return legacy.success ? legacy.data : null;
}

async function loadLegacyCanonicalSkill(
  projectDir: string,
  skillName: string,
): Promise<ScannedSkill | null> {
  for (const skillDir of [
    getProjectSkillDir(projectDir, skillName),
    join(projectDir, ".claude", "skills", skillName),
    join(projectDir, ".agents", "skills", skillName),
  ]) {
    const skill = await loadSkillPackageFromDir(skillDir);
    if (skill) {
      return skill;
    }
  }

  return null;
}

async function assertNoGlobalConflict(
  skillName: string,
  skill: ScannedSkill,
): Promise<void> {
  const existing = await loadGlobalCanonicalSkill(skillName);
  if (!existing) {
    return;
  }

  if (hashSkill(existing) !== hashSkill(skill)) {
    throw new Error(
      `Cannot migrate "${skillName}": a different global skill with the same name already exists.`,
    );
  }
}
