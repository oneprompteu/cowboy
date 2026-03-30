import {
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentType, ScannedSkill, SkillFile } from "./schemas.js";
import { scanDirectory } from "./scanner.js";

export function resolveGlobalCowboyDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userHome: string = homedir(),
): string {
  if (env.COWBOY_DATA_DIR?.trim()) {
    return resolve(env.COWBOY_DATA_DIR);
  }

  if (platform === "darwin") {
    return join(userHome, "Library", "Application Support", "Cowboy");
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || join(userHome, "AppData", "Local");
    return join(localAppData, "Cowboy");
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return xdgDataHome
    ? join(xdgDataHome, "cowboy")
    : join(userHome, ".local", "share", "cowboy");
}

export function getGlobalSkillsDir(): string {
  return join(resolveGlobalCowboyDir(), "skills");
}

export function getGlobalSkillDir(skillName: string): string {
  return join(getGlobalSkillsDir(), skillName);
}

export function getGlobalAgentViewsDir(agent: AgentType): string {
  return join(resolveGlobalCowboyDir(), "agent-views", agent);
}

export function getGlobalAgentViewDir(
  agent: AgentType,
  skillName: string,
): string {
  return join(getGlobalAgentViewsDir(agent), skillName);
}

export function getGlobalRegistryPath(): string {
  return join(resolveGlobalCowboyDir(), "registry.yaml");
}

export function getProjectSkillsDir(projectDir: string): string {
  return join(projectDir, ".cowboy", "skills");
}

export function getProjectSkillDir(projectDir: string, skillName: string): string {
  return join(getProjectSkillsDir(projectDir), skillName);
}

export function getProjectAgentSkillsDir(
  projectDir: string,
  agent: AgentType,
): string {
  return agent === "claude"
    ? join(projectDir, ".claude", "skills")
    : join(projectDir, ".agents", "skills");
}

export function getProjectAgentSkillDir(
  projectDir: string,
  agent: AgentType,
  skillName: string,
): string {
  return join(getProjectAgentSkillsDir(projectDir, agent), skillName);
}

export async function ensureGlobalStorageDirs(): Promise<void> {
  await mkdir(getGlobalSkillsDir(), { recursive: true });
  await mkdir(getGlobalAgentViewsDir("claude"), { recursive: true });
  await mkdir(getGlobalAgentViewsDir("codex"), { recursive: true });
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function writeSkillPackageToDir(
  skill: ScannedSkill,
  destDir: string,
  options?: {
    filterFile?: (file: SkillFile) => boolean;
    extraTextFiles?: Array<{ relativePath: string; content: string }>;
  },
): Promise<void> {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await writeFile(join(destDir, "SKILL.md"), skill.rawContent, "utf-8");

  const files = (skill.files ?? []).filter((file) => options?.filterFile ? options.filterFile(file) : true);
  for (const file of files) {
    const filePath = join(destDir, file.relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
  }

  for (const file of options?.extraTextFiles ?? []) {
    const filePath = join(destDir, file.relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf-8");
  }
}

export async function loadSkillPackageFromDir(
  skillDir: string,
): Promise<ScannedSkill | null> {
  try {
    const skills = await scanDirectory(skillDir);
    return skills[0] ?? null;
  } catch {
    return null;
  }
}

export async function writeGlobalCanonicalSkill(skill: ScannedSkill): Promise<void> {
  await ensureGlobalStorageDirs();
  await writeSkillPackageToDir(skill, getGlobalSkillDir(skill.name));
}

export async function loadGlobalCanonicalSkill(
  skillName: string,
): Promise<ScannedSkill | null> {
  return await loadSkillPackageFromDir(getGlobalSkillDir(skillName));
}

export async function ensureProjectCanonicalLink(
  projectDir: string,
  skillName: string,
): Promise<string> {
  const linkPath = getProjectSkillDir(projectDir, skillName);
  const targetPath = getGlobalSkillDir(skillName);
  await createDirectoryLink(targetPath, linkPath);
  return linkPath;
}

export async function ensureProjectAgentLink(
  projectDir: string,
  agent: AgentType,
  skillName: string,
): Promise<string> {
  const linkPath = getProjectAgentSkillDir(projectDir, agent, skillName);
  const targetPath = getGlobalAgentViewDir(agent, skillName);
  await createDirectoryLink(targetPath, linkPath);
  return linkPath;
}

export async function removeProjectCanonicalLink(
  projectDir: string,
  skillName: string,
): Promise<void> {
  await removePath(getProjectSkillDir(projectDir, skillName));
}

export async function removeProjectAgentLink(
  projectDir: string,
  agent: AgentType,
  skillName: string,
): Promise<void> {
  await removePath(getProjectAgentSkillDir(projectDir, agent, skillName));
}

export async function removeGlobalSkillFiles(skillName: string): Promise<void> {
  await removePath(getGlobalSkillDir(skillName));
  await removePath(getGlobalAgentViewDir("claude", skillName));
  await removePath(getGlobalAgentViewDir("codex", skillName));
}

export async function copyDirectoryDereferenced(
  sourceDir: string,
  destDir: string,
): Promise<void> {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(dirname(destDir), { recursive: true });
  await cp(sourceDir, destDir, { recursive: true, force: true, dereference: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function createDirectoryLink(targetPath: string, linkPath: string): Promise<void> {
  await rm(linkPath, { recursive: true, force: true });
  await mkdir(dirname(linkPath), { recursive: true });

  try {
    await symlink(
      resolve(targetPath),
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error: any) {
    throw new Error(
      `Failed to create skill link at ${linkPath}: ${error?.message ?? "unknown error"}`,
    );
  }
}
