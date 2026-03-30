import simpleGit from "simple-git";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, normalize, resolve as resolvePath } from "node:path";
import { parse as yamlParse } from "yaml";
import { runHeadlessAgentSession, type AIAgent } from "./ai-bridge.js";
import { scanDirectory } from "./scanner.js";
import type { ScannedSkill, SkillSource } from "./schemas.js";
import {
  copyDirectoryDereferenced,
  ensureProjectCanonicalLink,
  getProjectAgentSkillDir,
  loadGlobalCanonicalSkill,
  writeGlobalCanonicalSkill,
  writeSkillPackageToDir,
} from "./global-storage.js";
import { loadBuiltinSkills } from "./builtins.js";

const GENERATED_SKILLS_DIR = join(".cowboy", "skills");
const TEMP_DIR = join(".cowboy", ".tmp");
const SKILL_CREATOR_NAME = "skill-creator";

// Flat paths used inside the isolated generation workspace to avoid
// confusing nested .cowboy/ directories.
const WORKSPACE_SKILLS_DIR = "skills";
const WORKSPACE_REPOS_DIR = "repos";

export function extractRepoName(url: string): string {
  return url.replace(/\.git$/, "").replace(/\/$/, "").split("/").pop() ?? "repo";
}

export interface GenerateOptions {
  projectDir: string;
  aiAgent: AIAgent;
  agentModel?: string;
  agentEffort?: string;
  skillName?: string;
  source:
    | {
        type: "repo";
        libraryRepos: string[];
        docUrls?: string[];
      }
    | {
        type: "topic";
        researchQuery: string;
        docUrls?: string[];
      }
    | {
        type: "docs";
        docUrls: string[];
      };
  onProgress?: (message: string) => void;
}

export interface ResolveGeneratedSkillOptions {
  projectDir: string;
  expectedName?: string;
  previousSkillNames?: Set<string>;
  /** Explicit directory to scan instead of the default .cowboy/skills/. */
  skillsDir?: string;
}

export interface GenerateResult {
  skill: ScannedSkill;
  sources: SkillSource[];
  docUrls: string[];
}

export interface ClonedRepo {
  repoUrl: string;
  cloneDir: string;
  relPath: string;
  commitHash: string;
}

export interface ResolvedDocSources {
  entries: string[];
  webUrls: string[];
  localDirs: string[];
}

export function partitionDocSources(docSources: string[]): Omit<ResolvedDocSources, "entries"> {
  const webUrls: string[] = [];
  const localDirs: string[] = [];
  const seen = new Set<string>();

  for (const rawSource of docSources) {
    const source = rawSource.trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);

    if (isHttpUrl(source)) {
      webUrls.push(source);
    } else {
      localDirs.push(source);
    }
  }

  return { webUrls, localDirs };
}

export async function resolveDocSources(
  docSources: string[],
  baseDir: string,
): Promise<ResolvedDocSources> {
  const entries: string[] = [];
  const webUrls: string[] = [];
  const localDirs: string[] = [];
  const seen = new Set<string>();

  for (const rawSource of docSources) {
    const source = rawSource.trim();
    if (!source) continue;

    if (isHttpUrl(source)) {
      if (seen.has(source)) continue;
      seen.add(source);
      entries.push(source);
      webUrls.push(source);
      continue;
    }

    const resolvedDir = resolvePath(baseDir, source);
    let sourceStats;

    try {
      sourceStats = await stat(resolvedDir);
    } catch {
      throw new Error(`Local docs directory "${source}" was not found.`);
    }

    if (!sourceStats.isDirectory()) {
      throw new Error(`Local docs path "${source}" is not a directory.`);
    }

    if (seen.has(resolvedDir)) continue;
    seen.add(resolvedDir);
    entries.push(resolvedDir);
    localDirs.push(resolvedDir);
  }

  return { entries, webUrls, localDirs };
}

/**
 * Clone N repos to .cowboy/.tmp/<name>/ and capture HEAD hashes.
 */
export async function cloneRepos(
  projectDir: string,
  repoUrls: string[],
  opts?: { depth?: number; log?: (msg: string) => void; cloneBase?: string },
): Promise<ClonedRepo[]> {
  const depth = opts?.depth ?? 1;
  const log = opts?.log ?? (() => {});
  const base = opts?.cloneBase ?? TEMP_DIR;
  const results: ClonedRepo[] = [];

  for (const url of repoUrls) {
    const repoName = extractRepoName(url);
    const cloneDir = join(projectDir, base, repoName);
    const relPath = join(base, repoName);

    await rm(cloneDir, { recursive: true, force: true });
    await mkdir(cloneDir, { recursive: true });

    log(`Cloning ${repoName}...`);
    const git = simpleGit();
    await git.clone(url, cloneDir, ["--depth", String(depth)]);

    const repoGit = simpleGit(cloneDir);
    const commitHash = (await repoGit.revparse(["HEAD"])).trim();

    results.push({ repoUrl: url, cloneDir, relPath, commitHash });
  }

  return results;
}

/**
 * Remove all cloned repo directories.
 */
export async function cleanupClones(clones: ClonedRepo[]): Promise<void> {
  for (const clone of clones) {
    await rm(clone.cloneDir, { recursive: true, force: true });
  }
}

export async function generateSkill(
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { projectDir, aiAgent, agentModel, agentEffort, skillName, source } = options;
  const log = options.onProgress ?? (() => {});
  await ensureGeneratedSkillsDir(projectDir);
  log(`Preparing isolated ${aiAgent} workspace...`);
  const workspaceDir = await createIsolatedGenerationWorkspace(
    projectDir,
    aiAgent,
    skillName,
  );

  try {
    if (source.type === "repo") {
      return await generateSkillFromRepos({
        projectDir,
        workspaceDir,
        aiAgent,
        skillName,
        source,
        onProgress: options.onProgress,
      });
    }

    const resolvedDocSources = await resolveDocSources(
      source.docUrls ?? [],
      projectDir,
    );
    const docUrls = resolvedDocSources.entries;
    const prompt = source.type === "topic"
      ? createTopicGenerationSessionPrompt(source.researchQuery, skillName, docUrls)
      : createDocsGenerationSessionPrompt(docUrls, skillName);

    log(`Launching ${aiAgent} session...`);
    await runHeadlessAgentSession({
      agent: aiAgent,
      cwd: workspaceDir,
      prompt,
      addDirs: resolvedDocSources.localDirs,
      model: agentModel,
      effort: agentEffort,
    });

    const skill = await syncGeneratedSkillFromWorkspace(workspaceDir, skillName);

    const discoveredUrls = await parseSourcesYaml(workspaceDir, skill.name, WORKSPACE_SKILLS_DIR);
    let sources: SkillSource[] = [];

    if (discoveredUrls.length > 0) {
      log("Capturing versions from discovered sources...");
      const clones = await cloneRepos(workspaceDir, discoveredUrls, {
        log,
        cloneBase: WORKSPACE_REPOS_DIR,
      });
      sources = clones.map((c) => ({ repo: c.repoUrl, commit_hash: c.commitHash }));
      await cleanupClones(clones);
    }

    return { skill, sources, docUrls };
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

export async function ensureGeneratedSkillsDir(projectDir: string): Promise<string> {
  const dir = getGeneratedSkillsDir(projectDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function getGeneratedSkillsDir(projectDir: string): string {
  return join(projectDir, GENERATED_SKILLS_DIR);
}

export function getGeneratedSkillDir(
  projectDir: string,
  skillName: string,
): string {
  return join(getGeneratedSkillsDir(projectDir), skillName);
}

export async function scanGeneratedSkills(
  projectDir: string,
): Promise<ScannedSkill[]> {
  const skillsDir = getGeneratedSkillsDir(projectDir);

  try {
    return await scanDirectory(skillsDir);
  } catch {
    return [];
  }
}

export async function listGeneratedSkillNames(
  projectDir: string,
): Promise<Set<string>> {
  const skills = await scanGeneratedSkills(projectDir);
  return new Set(skills.map((skill) => skill.name));
}

export async function resolveGeneratedSkill(
  options: ResolveGeneratedSkillOptions,
): Promise<ScannedSkill> {
  const skills = options.skillsDir
    ? await scanDirectory(options.skillsDir).catch(() => [] as ScannedSkill[])
    : await scanGeneratedSkills(options.projectDir);

  if (options.expectedName) {
    const skill = skills.find((entry) => entry.name === options.expectedName);
    if (!skill) {
      throw new Error(
        `Expected skill "${options.expectedName}" in ${GENERATED_SKILLS_DIR}/${options.expectedName}/.`,
      );
    }

    validateGeneratedSkillLayout(skill);
    return skill;
  }

  const previousSkillNames = options.previousSkillNames ?? new Set<string>();
  const added = skills.filter((skill) => !previousSkillNames.has(skill.name));

  if (added.length === 0) {
    throw new Error(
      `No new valid skill was created in ${GENERATED_SKILLS_DIR}/.`,
    );
  }

  if (added.length > 1) {
    const names = added.map((skill) => skill.name).join(", ");
    throw new Error(
      `Expected exactly one new skill in ${GENERATED_SKILLS_DIR}/, found: ${names}.`,
    );
  }

  validateGeneratedSkillLayout(added[0]);
  return added[0];
}

export async function ensureGeneratedSkillSource(
  projectDir: string,
  skillName: string,
): Promise<void> {
  const globalSkill = await loadGlobalCanonicalSkill(skillName);
  if (globalSkill) {
    await ensureProjectCanonicalLink(projectDir, skillName);
    return;
  }

  const skill = await loadInstalledGeneratedSkill(projectDir, skillName);
  if (!skill) {
    throw new Error(
      `Generated skill "${skillName}" was not found in ${GENERATED_SKILLS_DIR}/ or installed agent directories.`,
    );
  }

  await writeGeneratedSkillSource(projectDir, sanitizeGeneratedSkill(skill));
}

export async function writeGeneratedSkillSource(
  projectDir: string,
  skill: ScannedSkill,
): Promise<void> {
  await writeGlobalCanonicalSkill(skill);
  await ensureProjectCanonicalLink(projectDir, skill.name);
}

// --- Prompt builders ---

export function createRepoGenerationSessionPrompt(
  repoPath: string,
  skillName?: string,
  docUrls?: string[],
): string {
  const target = skillName
    ? `Create a skill named "${skillName}" and write it to skills/${skillName}/.`
    : "Choose a concise kebab-case name and create the skill under skills/<name>/.";

  const lines = [
    `Create a self-contained skill package for the library in ${repoPath}.`,
    "Use the installed skill-creator skill as guide.",
    "Base the package on the library's documentation, examples, tests, and source layout. Do not model it on other skills in the workspace.",
    "For a library skill, cover the library broadly but compress intelligently: keep high-signal concepts, setup rules, workflows, examples, configuration, and gotchas while removing repetition and low-value prose.",
    "Keep SKILL.md focused on orientation and task routing. Put longer technical material in companion files such as references/, examples, or scripts when they materially improve the skill.",
    "Choose the package structure freely. Do not force a fixed file template, but make the final skill easy to navigate.",
    "Only add scripts when they capture deterministic, reusable operations. Do not add placeholder or decorative scripts.",
    target,
  ];

  appendDocsSection(lines, docUrls);
  return lines.join("\n");
}

export function createMultiRepoGenerationSessionPrompt(
  repos: { repoUrl: string; relPath: string }[],
  skillName?: string,
  docUrls?: string[],
): string {
  if (repos.length === 1) {
    return createRepoGenerationSessionPrompt(repos[0].relPath, skillName, docUrls);
  }

  const repoList = repos
    .map((r) => `- ${extractRepoName(r.repoUrl)} (${r.relPath})`)
    .join("\n");

  const target = skillName
    ? `Create a unified skill named "${skillName}" and write it to skills/${skillName}/.`
    : "Choose a concise kebab-case name and create the skill under skills/<name>/.";

  const lines = [
    "Create a unified self-contained skill package that covers the following libraries:",
    "",
    repoList,
    "",
    "Study each library repository and synthesize a comprehensive package.",
    "Use the installed skill-creator skill as guide.",
    "Derive the package structure from the libraries' documentation, examples, tests, and source layout. Do not model it on other skills in the workspace.",
    "Cover the libraries broadly but compress intelligently: keep the high-signal concepts, integration patterns, configuration, examples, and gotchas while removing repetition and low-value prose.",
    "Keep SKILL.md focused on orientation and task routing. Put longer technical material in companion files such as references/, examples, or scripts when they materially improve the skill.",
    "Choose the package structure freely. Do not force a fixed file template, but make the final skill easy to navigate.",
    "Only add scripts when they capture deterministic, reusable operations. Do not add placeholder or decorative scripts.",
    target,
  ];

  appendDocsSection(lines, docUrls);
  return lines.join("\n");
}

export function createTopicGenerationSessionPrompt(
  researchQuery: string,
  skillName?: string,
  docUrls?: string[],
): string {
  const targetInstruction = skillName
    ? [
        `Create or update exactly one portable skill named "${skillName}".`,
        `Write it directly to skills/${skillName}/.`,
        "The directory name and the frontmatter name must match exactly.",
      ].join(" ")
    : [
        "Choose a concise kebab-case skill name.",
        "Create exactly one portable skill under skills/<skill-name>/.",
        "The directory name and the frontmatter name must match exactly.",
      ].join(" ");

  const lines = [
    `Create a portable self-contained skill package for this topic: "${researchQuery}".`,
    "Identify the canonical project, package, framework, or specification that best matches the topic before writing the skill.",
    "Use the installed skill-creator skill as guide.",
    "Base the package on the topic's official documentation, maintainer examples, and primary sources. Do not model it on other skills in the workspace.",
    "Prefer official documentation, maintainer repositories, package indexes, and primary specifications when research is needed.",
    "Use secondary blogs or tutorials only to fill gaps left by the primary sources.",
    "For a library, package, or framework topic, cover it broadly but compress intelligently: keep the high-signal concepts, setup rules, workflows, examples, configuration, and gotchas while removing repetition and low-value prose.",
    targetInstruction,
    "Keep SKILL.md focused on orientation and task routing. Put longer technical material in companion files such as references/, examples, or scripts when they materially improve the skill.",
    "Choose the package structure freely. Do not force a fixed file template, but make the final skill easy to navigate.",
    "Only add scripts when they capture deterministic, reusable operations. Do not add placeholder or decorative scripts.",
    "Write the final files directly to disk: SKILL.md plus any companion files that materially improve the skill package.",
    "After writing the skill files, create a sources.yaml file in the skill directory listing the GitHub repository URLs you used as primary sources. Format:\nrepos:\n  - https://github.com/org/repo",
  ];

  appendDocsSection(lines, docUrls);
  return lines.join("\n\n");
}

export function createRepoUpdateSessionPrompt(
  skillName: string,
  repoPath: string,
  diffSummary?: string,
  docUrls?: string[],
): string {
  const lines = [
    `Update the skill "${skillName}" in .cowboy/skills/${skillName}/.`,
    `Study the library repository in ${repoPath} for changes.`,
    "Edit files in place. Keep the directory name and the frontmatter name aligned.",
  ];

  if (diffSummary) {
    lines.push(
      "",
      "Here is what changed in the library since the skill was last generated/updated:",
      "",
      diffSummary,
    );
  }

  appendDocsSection(lines, docUrls);
  return lines.join("\n");
}

export function createMultiSourceUpdateSessionPrompt(
  skillName: string,
  repoSections: { repoUrl: string; relPath: string; diffSummary?: string }[],
  docUrls?: string[],
): string {
  if (repoSections.length === 1) {
    return createRepoUpdateSessionPrompt(
      skillName,
      repoSections[0].relPath,
      repoSections[0].diffSummary,
      docUrls,
    );
  }

  const lines = [
    `Update the skill "${skillName}" in .cowboy/skills/${skillName}/.`,
    "This skill is based on multiple source repositories. Study each for changes and update the skill accordingly.",
    "Edit files in place. Keep the directory name and the frontmatter name aligned.",
  ];

  for (const section of repoSections) {
    const name = extractRepoName(section.repoUrl);
    lines.push("", `## ${name} (${section.relPath})`);

    if (section.diffSummary) {
      lines.push("", section.diffSummary);
    } else {
      lines.push("No specific changes detected. Review for any updates.");
    }
  }

  appendDocsSection(lines, docUrls);
  return lines.join("\n");
}

export function createTopicUpdateSessionPrompt(
  skillName: string,
  researchQuery: string,
  docUrls?: string[],
): string {
  const lines = [
    `Update the portable skill "${skillName}" in .cowboy/skills/${skillName}/.`,
    `Refresh it for this topic: "${researchQuery}".`,
    "Identify the canonical project, package, framework, or specification before editing.",
    "Use the installed skill-creator skill to shape the result.",
    "Prefer official documentation, maintainer repositories, package indexes, and other primary sources.",
    "Use secondary sources only to fill gaps left by the official material.",
    "Keep the skill portable: SKILL.md and any companion files belong under .cowboy/skills/.",
    "Edit files in place instead of printing the final skill content in chat.",
    "Keep the directory name and the frontmatter name aligned.",
    "After updating, create or update sources.yaml in the skill directory listing the GitHub repository URLs you used as primary sources. Format:\nrepos:\n  - https://github.com/org/repo",
  ];

  appendDocsSection(lines, docUrls);
  return lines.join("\n\n");
}

export function createDocsGenerationSessionPrompt(
  docUrls: string[],
  skillName?: string,
): string {
  const target = skillName
    ? `Create a skill named "${skillName}" and write it to skills/${skillName}/.`
    : "Choose a concise kebab-case name and create the skill under skills/<name>/.";

  return [
    "Create a self-contained skill package based on the following documentation sources:",
    formatDocSourceSummary(docUrls),
    "Use your web browsing tools to thoroughly read these documentation websites.",
    "Use the installed skill-creator skill as guide.",
    "Cover the subject broadly but compress intelligently: keep high-signal concepts, setup rules, workflows, examples, configuration, and gotchas while removing repetition and low-value prose.",
    "Keep SKILL.md focused on orientation and task routing. Put longer technical material in companion files such as references/, examples, or scripts when they materially improve the skill.",
    "Choose the package structure freely. Do not force a fixed file template, but make the final skill easy to navigate.",
    "Only add scripts when they capture deterministic, reusable operations. Do not add placeholder or decorative scripts.",
    target,
    "After writing the skill files, create a sources.yaml file in the skill directory listing any GitHub repository URLs you used as primary sources. Format:\nrepos:\n  - https://github.com/org/repo",
  ].join("\n\n");
}

export function createDocsUpdateSessionPrompt(
  skillName: string,
  docUrls: string[],
): string {
  return [
    `Update the skill "${skillName}" in .cowboy/skills/${skillName}/.`,
    "Re-read these documentation sources for any updates:",
    formatDocSourceSummary(docUrls),
    "Use your web browsing tools for websites and read local directories directly.",
    "Edit files in place. Keep the directory name and the frontmatter name aligned.",
    "After updating, create or update sources.yaml in the skill directory listing any GitHub repository URLs you used as primary sources. Format:\nrepos:\n  - https://github.com/org/repo",
  ].join("\n\n");
}

// --- sources.yaml ---

/**
 * Parse a sources.yaml file written by the agent after generation/update.
 * Returns repo URLs. Returns empty array if file is missing or malformed.
 */
export async function parseSourcesYaml(
  projectDir: string,
  skillName: string,
  skillsBase?: string,
): Promise<string[]> {
  const base = skillsBase ?? GENERATED_SKILLS_DIR;
  const filePath = join(projectDir, base, skillName, "sources.yaml");

  try {
    const content = await readFile(filePath, "utf-8");
    const data = yamlParse(content);

    if (data?.repos && Array.isArray(data.repos)) {
      return data.repos.filter(
        (url: unknown) => typeof url === "string" && url.startsWith("https://"),
      );
    }

    return [];
  } catch {
    return [];
  }
}

// --- Private helpers ---

async function generateSkillFromRepos(
  options: GenerateOptions & {
    workspaceDir: string;
    source: { type: "repo"; libraryRepos: string[]; docUrls?: string[] };
  },
): Promise<GenerateResult> {
  const { projectDir, workspaceDir, aiAgent, skillName, source } = options;
  const log = options.onProgress ?? (() => {});
  const resolvedDocSources = await resolveDocSources(
    source.docUrls ?? [],
    projectDir,
  );
  const docUrls = resolvedDocSources.entries;

  const clones = await cloneRepos(workspaceDir, source.libraryRepos, {
    log,
    cloneBase: WORKSPACE_REPOS_DIR,
  });

  try {
    log(`Launching ${aiAgent} session...`);
    const prompt = createMultiRepoGenerationSessionPrompt(
      clones.map((c) => ({ repoUrl: c.repoUrl, relPath: c.relPath })),
      skillName,
      docUrls.length > 0 ? docUrls : undefined,
    );

    await runHeadlessAgentSession({
      agent: aiAgent,
      cwd: workspaceDir,
      prompt,
      addDirs: resolvedDocSources.localDirs,
      model: options.agentModel,
      effort: options.agentEffort,
    });

    const skill = await syncGeneratedSkillFromWorkspace(workspaceDir, skillName);

    const sources: SkillSource[] = clones.map((c) => ({
      repo: c.repoUrl,
      commit_hash: c.commitHash,
    }));

    return { skill, sources, docUrls };
  } finally {
    await cleanupClones(clones);
  }
}

function validateGeneratedSkillLayout(skill: ScannedSkill): void {
  const expectedRelativePath = normalize(join(skill.name, "SKILL.md"));
  const actualRelativePath = normalize(skill.relativePath);

  if (actualRelativePath !== expectedRelativePath) {
    throw new Error(
      `Generated skill "${skill.name}" must live at ${GENERATED_SKILLS_DIR}/${skill.name}/SKILL.md.`,
    );
  }
}

async function loadInstalledGeneratedSkill(
  projectDir: string,
  skillName: string,
): Promise<ScannedSkill | null> {
  for (const dir of [
    join(projectDir, ".claude", "skills", skillName),
    join(projectDir, ".agents", "skills", skillName),
  ]) {
    const skill = await readInstalledSkillDirectory(dir);
    if (skill) {
      return skill;
    }
  }

  return null;
}

async function readInstalledSkillDirectory(
  skillDir: string,
): Promise<ScannedSkill | null> {
  try {
    const skills = await scanDirectory(skillDir);
    return skills[0] ?? null;
  } catch {
    return null;
  }
}

function sanitizeGeneratedSkill(skill: ScannedSkill): ScannedSkill {
  const excludedPaths = new Set(["sources.yaml"]);
  const files = (skill.files ?? []).filter(
    (file) => !excludedPaths.has(toPortablePath(file.relativePath)),
  );

  return {
    ...skill,
    files: files.length > 0 ? files : undefined,
  };
}

function toPortablePath(path: string): string {
  return path.split("\\").join("/");
}

async function createIsolatedGenerationWorkspace(
  projectDir: string,
  aiAgent: AIAgent,
  skillName?: string,
): Promise<string> {
  const tempRoot = join(projectDir, TEMP_DIR);
  await mkdir(tempRoot, { recursive: true });
  const workspaceDir = await mkdtemp(join(tempRoot, "generate-"));

  try {
    await mkdir(join(workspaceDir, WORKSPACE_SKILLS_DIR), { recursive: true });
    await copyFileIfExists(
      join(projectDir, ".cowboy", "config.yaml"),
      join(workspaceDir, "config.yaml"),
    );

    if (skillName) {
      await copyDirIfExists(
        getGeneratedSkillDir(projectDir, skillName),
        join(workspaceDir, WORKSPACE_SKILLS_DIR, skillName),
      );
    }

    await installBuiltinSkillInWorkspace(workspaceDir, aiAgent, SKILL_CREATOR_NAME);

    return workspaceDir;
  } catch (error) {
    await rm(workspaceDir, { recursive: true, force: true });
    throw error;
  }
}

async function syncGeneratedSkillFromWorkspace(
  workspaceDir: string,
  expectedName?: string,
): Promise<ScannedSkill> {
  const skill = await resolveGeneratedSkill({
    projectDir: workspaceDir,
    expectedName,
    skillsDir: join(workspaceDir, WORKSPACE_SKILLS_DIR),
  });
  return sanitizeGeneratedSkill(skill);
}

function getInstalledSkillDir(
  projectDir: string,
  aiAgent: AIAgent,
  skillName: string,
): string {
  const baseDir = aiAgent === "claude"
    ? join(projectDir, ".claude", "skills")
    : join(projectDir, ".agents", "skills");

  return join(baseDir, skillName);
}

async function copyDirIfExists(sourceDir: string, destDir: string): Promise<void> {
  try {
    await copyDirectoryDereferenced(sourceDir, destDir);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function copyFileIfExists(sourcePath: string, destPath: string): Promise<void> {
  try {
    await mkdir(dirname(destPath), { recursive: true });
    await cp(sourcePath, destPath, { force: true });
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function appendDocsSection(lines: string[], docUrls?: string[]): void {
  if (!docUrls || docUrls.length === 0) return;
  const docsSummary = formatDocSourceSummary(docUrls);
  lines.push(
    "",
    "Also consult these documentation sources as primary reference:",
    docsSummary,
  );
}

function formatDocSourceSummary(docSources: string[]): string {
  const { webUrls, localDirs } = partitionDocSources(docSources);
  const sections: string[] = [];

  if (webUrls.length > 0) {
    sections.push([
      "Documentation websites:",
      webUrls.map((url) => `- ${url}`).join("\n"),
      "Use your web browsing tools to read them.",
    ].join("\n"));
  }

  if (localDirs.length > 0) {
    sections.push([
      "Local documentation directories:",
      localDirs.map((dir) => `- ${dir}`).join("\n"),
      "These directories are already accessible in the workspace. Read their files directly.",
    ].join("\n"));
  }

  return sections.join("\n\n");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function installBuiltinSkillInWorkspace(
  workspaceDir: string,
  aiAgent: AIAgent,
  skillName: string,
): Promise<void> {
  const builtins = await loadBuiltinSkills();
  const skill = builtins.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Built-in skill "${skillName}" not found.`);
  }

  const hasOpenAIYaml = (skill.files ?? []).some((file) => file.relativePath === "agents/openai.yaml");
  await writeSkillPackageToDir(skill, getProjectAgentSkillDir(workspaceDir, aiAgent, skillName), {
    extraTextFiles: aiAgent === "codex" && !hasOpenAIYaml
      ? [{ relativePath: "agents/openai.yaml", content: generateWorkspaceOpenAIYaml(skill) }]
      : undefined,
  });
}

function generateWorkspaceOpenAIYaml(skill: ScannedSkill): string {
  return [
    "interface:",
    `  display_name: ${skill.name}`,
    `  short_description: ${JSON.stringify(skill.description)}`,
    "  brand_color: \"#000000\"",
    `  default_prompt: ${JSON.stringify(`Use the ${skill.name} skill`)}`,
    "policy:",
    "  allow_implicit_invocation: true",
    "",
  ].join("\n");
}
