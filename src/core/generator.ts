import simpleGit from "simple-git";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { parse as yamlParse } from "yaml";
import { runHeadlessAgentSession, type AIAgent } from "./ai-bridge.js";
import { scanDirectory } from "./scanner.js";
import type { ScannedSkill, SkillSource } from "./schemas.js";

const GENERATED_SKILLS_DIR = join(".cowboy", "skills");
const TEMP_DIR = join(".cowboy", ".tmp");

export function extractRepoName(url: string): string {
  return url.replace(/\.git$/, "").replace(/\/$/, "").split("/").pop() ?? "repo";
}

export interface GenerateOptions {
  projectDir: string;
  aiAgent: AIAgent;
  skillName?: string;
  source:
    | {
        type: "repo";
        libraryRepos: string[];
      }
    | {
        type: "topic";
        researchQuery: string;
      };
  onProgress?: (message: string) => void;
}

export interface ResolveGeneratedSkillOptions {
  projectDir: string;
  expectedName?: string;
  previousSkillNames?: Set<string>;
}

export interface GenerateResult {
  skill: ScannedSkill;
  sources: SkillSource[];
}

export interface ClonedRepo {
  repoUrl: string;
  cloneDir: string;
  relPath: string;
  commitHash: string;
}

/**
 * Clone N repos to .cowboy/.tmp/<name>/ and capture HEAD hashes.
 */
export async function cloneRepos(
  projectDir: string,
  repoUrls: string[],
  opts?: { depth?: number; log?: (msg: string) => void },
): Promise<ClonedRepo[]> {
  const depth = opts?.depth ?? 1;
  const log = opts?.log ?? (() => {});
  const results: ClonedRepo[] = [];

  for (const url of repoUrls) {
    const repoName = extractRepoName(url);
    const cloneDir = join(projectDir, TEMP_DIR, repoName);
    const relPath = join(TEMP_DIR, repoName);

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
  const { projectDir, aiAgent, skillName, source } = options;
  const log = options.onProgress ?? (() => {});
  const previousSkillNamesPromise = (async () => {
    await ensureGeneratedSkillsDir(projectDir);
    return listGeneratedSkillNames(projectDir);
  })();

  const previousSkillNames = await previousSkillNamesPromise;

  if (source.type === "repo") {
    return await generateSkillFromRepos({
      projectDir,
      aiAgent,
      skillName,
      source,
      onProgress: options.onProgress,
      previousSkillNames,
    });
  }

  // Topic-based generation
  log(`Launching ${aiAgent} session...`);
  await runHeadlessAgentSession({
    agent: aiAgent,
    cwd: projectDir,
    prompt: createTopicGenerationSessionPrompt(source.researchQuery, skillName),
  });

  const skill = await resolveGeneratedSkill({
    projectDir,
    expectedName: skillName,
    previousSkillNames,
  });

  // Try to capture sources from agent-written sources.yaml
  const discoveredUrls = await parseSourcesYaml(projectDir, skill.name);
  let sources: SkillSource[] = [];

  if (discoveredUrls.length > 0) {
    log("Capturing versions from discovered sources...");
    const clones = await cloneRepos(projectDir, discoveredUrls, { log });
    sources = clones.map((c) => ({ repo: c.repoUrl, commit_hash: c.commitHash }));
    await cleanupClones(clones);
  }

  return { skill, sources };
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
  const skills = await scanGeneratedSkills(options.projectDir);

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
  const canonicalDir = getGeneratedSkillDir(projectDir, skillName);

  try {
    await readFile(join(canonicalDir, "SKILL.md"), "utf-8");
    return;
  } catch {
    // Fall through to bootstrap from an installed copy.
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
  const skillDir = getGeneratedSkillDir(projectDir, skill.name);

  await rm(skillDir, { recursive: true, force: true });
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skill.rawContent, "utf-8");

  for (const file of skill.files ?? []) {
    const filePath = join(skillDir, file.relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
  }
}

// --- Prompt builders ---

export function createRepoGenerationSessionPrompt(
  repoPath: string,
  skillName?: string,
): string {
  const target = skillName
    ? `Create a skill named "${skillName}" and write it to .cowboy/skills/${skillName}/.`
    : "Choose a concise kebab-case name and create the skill under .cowboy/skills/<name>/.";

  return [
    `Create a skill for the library in ${repoPath}.`,
    "Use the installed skill-creator skill as guide.",
    target,
  ].join("\n");
}

export function createMultiRepoGenerationSessionPrompt(
  repos: { repoUrl: string; relPath: string }[],
  skillName?: string,
): string {
  if (repos.length === 1) {
    return createRepoGenerationSessionPrompt(repos[0].relPath, skillName);
  }

  const repoList = repos
    .map((r) => `- ${extractRepoName(r.repoUrl)} (${r.relPath})`)
    .join("\n");

  const target = skillName
    ? `Create a unified skill named "${skillName}" and write it to .cowboy/skills/${skillName}/.`
    : "Choose a concise kebab-case name and create the skill under .cowboy/skills/<name>/.";

  return [
    "Create a unified skill that covers the following libraries:",
    "",
    repoList,
    "",
    "Study each library repository and synthesize a comprehensive skill.",
    "Use the installed skill-creator skill as guide.",
    target,
  ].join("\n");
}

export function createTopicGenerationSessionPrompt(
  researchQuery: string,
  skillName?: string,
): string {
  const targetInstruction = skillName
    ? [
        `Create or update exactly one portable skill named "${skillName}".`,
        `Write it directly to .cowboy/skills/${skillName}/.`,
        "The directory name and the frontmatter name must match exactly.",
      ].join(" ")
    : [
        "Choose a concise kebab-case skill name.",
        "Create exactly one portable skill under .cowboy/skills/<skill-name>/.",
        "The directory name and the frontmatter name must match exactly.",
      ].join(" ");

  return [
    `Create a portable skill for this topic: "${researchQuery}".`,
    "Identify the canonical project, package, framework, or specification that best matches the topic before writing the skill.",
    "Use the installed skill-creator skill as guide.",
    "Prefer official documentation, maintainer repositories, package indexes, and primary specifications when research is needed.",
    "Use secondary blogs or tutorials only to fill gaps left by the primary sources.",
    targetInstruction,
    "Write the final files directly to disk: SKILL.md plus only the companion files that materially improve the skill.",
    "After writing the skill files, create a sources.yaml file in the skill directory listing the GitHub repository URLs you used as primary sources. Format:\nrepos:\n  - https://github.com/org/repo",
  ].join("\n\n");
}

export function createRepoUpdateSessionPrompt(
  skillName: string,
  repoPath: string,
  diffSummary?: string,
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

  return lines.join("\n");
}

export function createMultiSourceUpdateSessionPrompt(
  skillName: string,
  repoSections: { repoUrl: string; relPath: string; diffSummary?: string }[],
): string {
  if (repoSections.length === 1) {
    return createRepoUpdateSessionPrompt(
      skillName,
      repoSections[0].relPath,
      repoSections[0].diffSummary,
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

  return lines.join("\n");
}

export function createTopicUpdateSessionPrompt(
  skillName: string,
  researchQuery: string,
): string {
  return [
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
): Promise<string[]> {
  const filePath = join(
    getGeneratedSkillDir(projectDir, skillName),
    "sources.yaml",
  );

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
    source: { type: "repo"; libraryRepos: string[] };
    previousSkillNames: Set<string>;
  },
): Promise<GenerateResult> {
  const { projectDir, aiAgent, skillName, source, previousSkillNames } = options;
  const log = options.onProgress ?? (() => {});

  const clones = await cloneRepos(projectDir, source.libraryRepos, { log });

  try {
    log(`Launching ${aiAgent} session...`);
    const prompt = createMultiRepoGenerationSessionPrompt(
      clones.map((c) => ({ repoUrl: c.repoUrl, relPath: c.relPath })),
      skillName,
    );

    await runHeadlessAgentSession({
      agent: aiAgent,
      cwd: projectDir,
      prompt,
    });

    const skill = await resolveGeneratedSkill({
      projectDir,
      expectedName: skillName,
      previousSkillNames,
    });

    const sources: SkillSource[] = clones.map((c) => ({
      repo: c.repoUrl,
      commit_hash: c.commitHash,
    }));

    return { skill, sources };
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
  const excludedPaths = new Set(["agents/openai.yaml", "sources.yaml"]);
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
