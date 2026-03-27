import simpleGit from "simple-git";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRegistry } from "./tracker.js";
import { scanDirectory } from "./scanner.js";
import { installSkill, installGeneratedSkill } from "./installer.js";
import { type AIAgent, runInteractiveAgentSession } from "./ai-bridge.js";
import { loadBuiltinSkills } from "./builtins.js";
import {
  cloneRepos,
  cleanupClones,
  createDocsUpdateSessionPrompt,
  createMultiSourceUpdateSessionPrompt,
  createTopicUpdateSessionPrompt,
  ensureGeneratedSkillSource,
  extractRepoName,
  parseSourcesYaml,
  resolveDocSources,
  resolveGeneratedSkill,
} from "./generator.js";
import type { ImportedSkill, GeneratedSkill, ScannedSkill, SkillSource } from "./schemas.js";

export interface UpdateResult {
  name: string;
  type: "imported" | "generated";
  updated: boolean;
  reason: string;
}

export interface UpdateOptions {
  projectDir: string;
  skillName?: string;
  aiAgent?: AIAgent;
  agentModel?: string;
  agentEffort?: string;
  onProgress?: (message: string) => void;
}

/**
 * Update installed skills.
 * - Imported: re-fetch from source repo, compare hash, replace if changed.
 * - Generated: check source repos for changes, let the configured agent update files in place.
 */
export async function updateSkills(
  options: UpdateOptions,
): Promise<UpdateResult[]> {
  const { projectDir, skillName } = options;
  const registry = await readRegistry(projectDir);

  const skills = skillName
    ? registry.skills.filter((skill) => skill.name === skillName)
    : registry.skills;

  if (skills.length === 0) {
    return [];
  }

  const results: UpdateResult[] = [];
  const log = options.onProgress ?? (() => {});

  for (const skill of skills) {
    if (skill.type === "imported") {
      const isBuiltin = skill.source_repo === "builtin";
      log(`Checking ${skill.name} (${isBuiltin ? "builtin" : "imported"})...`);
      results.push(
        await (isBuiltin
          ? updateBuiltinSkill(skill, projectDir)
          : updateImportedSkill(skill, projectDir, log)),
      );
      continue;
    }

    log(`Checking ${skill.name} (generated)...`);
    results.push(
      await updateGeneratedSkill(
        skill,
        projectDir,
        log,
        options.aiAgent,
        options.agentModel,
        options.agentEffort,
      ),
    );
  }

  return results;
}

async function updateBuiltinSkill(
  skill: ImportedSkill,
  projectDir: string,
): Promise<UpdateResult> {
  const builtins = await loadBuiltinSkills();
  const updated = builtins.find((entry) => entry.name === skill.name);

  return await finalizeImportedSkillUpdate(
    skill,
    updated,
    projectDir,
    "Built-in skill no longer exists",
    "Updated built-in skill",
  );
}

async function updateImportedSkill(
  skill: ImportedSkill,
  projectDir: string,
  log: (msg: string) => void,
): Promise<UpdateResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "cowboy-update-"));

  try {
    log("Cloning source repo...");
    const git = simpleGit();
    await git.clone(skill.source_repo, tempDir, ["--depth", "1"]);

    log("Comparing content...");
    const scanned = await scanDirectory(tempDir);
    const updated = scanned.find((entry) => entry.name === skill.name);

    return await finalizeImportedSkillUpdate(
      skill,
      updated,
      projectDir,
      "Skill no longer exists in source repo",
      "Updated from source",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function finalizeImportedSkillUpdate(
  skill: ImportedSkill,
  updated: ScannedSkill | undefined,
  projectDir: string,
  missingReason: string,
  updatedReason: string,
): Promise<UpdateResult> {
  if (!updated) {
    return {
      name: skill.name,
      type: "imported",
      updated: false,
      reason: missingReason,
    };
  }

  const newHash = hashSkill(updated);
  if (newHash === skill.content_hash) {
    return {
      name: skill.name,
      type: "imported",
      updated: false,
      reason: "Already up to date",
    };
  }

  await installSkill({
    skill: updated,
    projectDir,
    agents: skill.installed_for,
    sourceRepo: skill.source_repo,
  });

  return {
    name: skill.name,
    type: "imported",
    updated: true,
    reason: updatedReason,
  };
}

async function updateGeneratedSkill(
  skill: GeneratedSkill,
  projectDir: string,
  log: (msg: string) => void,
  aiAgent?: AIAgent,
  agentModel?: string,
  agentEffort?: string,
): Promise<UpdateResult> {
  if (!aiAgent) {
    throw new Error(
      "Generated skill updates require a configured AI agent CLI.",
    );
  }

  const sources = skill.sources ?? [];
  const docUrls = skill.doc_urls ?? [];

  if (sources.length > 0) {
    return await updateSourcedSkill(skill, sources, projectDir, log, aiAgent, agentModel, agentEffort);
  }

  if (docUrls.length > 0) {
    return await updateDocsOnlySkill(skill, docUrls, projectDir, log, aiAgent, agentModel, agentEffort);
  }

  if (skill.research_query) {
    return await updateTopicGeneratedSkill(skill, projectDir, log, aiAgent, agentModel, agentEffort);
  }

  throw new Error(
    `Generated skill "${skill.name}" has no sources, doc_urls, or research_query.`,
  );
}

interface SourceDiffResult {
  repoUrl: string;
  relPath: string;
  newCommitHash: string;
  diffSummary?: string;
  commitCount: number;
}

async function updateSourcedSkill(
  skill: GeneratedSkill,
  sources: SkillSource[],
  projectDir: string,
  log: (msg: string) => void,
  aiAgent: AIAgent,
  agentModel?: string,
  agentEffort?: string,
): Promise<UpdateResult> {
  const clones = await cloneRepos(
    projectDir,
    sources.map((s) => s.repo),
    { depth: 50, log },
  );

  try {
    log("Checking for changes...");
    const diffResults: SourceDiffResult[] = [];
    let totalCommits = 0;

    for (const clone of clones) {
      const source = sources.find((s) => s.repo === clone.repoUrl);
      const result = await computeSourceDiff(clone, source, skill.last_updated);
      diffResults.push(result);
      totalCommits += result.commitCount;
    }

    if (totalCommits === 0) {
      return {
        name: skill.name,
        type: "generated",
        updated: false,
        reason: "No changes in library repo",
      };
    }

    await ensureGeneratedSkillSource(projectDir, skill.name);

    const resolvedDocSources = await resolveDocSources(
      skill.doc_urls ?? [],
      projectDir,
    );
    const docUrls = resolvedDocSources.entries;

    log(`Launching ${aiAgent} interactive session...`);
    await runInteractiveAgentSession({
      agent: aiAgent,
      cwd: projectDir,
      prompt: createMultiSourceUpdateSessionPrompt(
        skill.name,
        diffResults.map((r) => ({
          repoUrl: r.repoUrl,
          relPath: r.relPath,
          diffSummary: r.diffSummary,
        })),
        docUrls.length > 0 ? docUrls : undefined,
      ),
      addDirs: resolvedDocSources.localDirs,
      model: agentModel,
      effort: agentEffort,
    });

    const updatedSkill = await resolveGeneratedSkill({
      projectDir,
      expectedName: skill.name,
    });

    const today = new Date().toISOString().split("T")[0];
    const newSources: SkillSource[] = diffResults.map((r) => ({
      repo: r.repoUrl,
      commit_hash: r.newCommitHash,
    }));

    await installGeneratedSkill({
      skill: updatedSkill,
      projectDir,
      agents: skill.installed_for,
      sources: newSources,
      docUrls: docUrls.length > 0 ? docUrls : undefined,
      researchQuery: skill.research_query,
      installedAt: skill.installed_at,
      lastUpdated: today,
    });

    return {
      name: skill.name,
      type: "generated",
      updated: true,
      reason: `Updated based on ${totalCommits} new commit(s)`,
    };
  } finally {
    await cleanupClones(clones);
  }
}

async function computeSourceDiff(
  clone: { repoUrl: string; cloneDir: string; relPath: string; commitHash: string },
  source: SkillSource | undefined,
  lastUpdated: string,
): Promise<SourceDiffResult> {
  const repoGit = simpleGit(clone.cloneDir);
  const storedHash = source?.commit_hash;

  if (storedHash) {
    try {
      const [diffStat, logResult] = await Promise.all([
        repoGit.diff([`${storedHash}..HEAD`, "--stat"]),
        repoGit.log([`${storedHash}..HEAD`]),
      ]);

      const commitCount = logResult.total;
      if (commitCount === 0) {
        return {
          repoUrl: clone.repoUrl,
          relPath: clone.relPath,
          newCommitHash: clone.commitHash,
          commitCount: 0,
        };
      }

      const logLines = logResult.all
        .map((entry) => `  ${entry.hash.slice(0, 7)} ${entry.message}`)
        .join("\n");
      const diffSummary = [
        `${commitCount} commit(s) since ${storedHash.slice(0, 7)}:`,
        logLines,
        "",
        diffStat.trim(),
      ].join("\n");

      return {
        repoUrl: clone.repoUrl,
        relPath: clone.relPath,
        newCommitHash: clone.commitHash,
        diffSummary,
        commitCount,
      };
    } catch {
      // Hash not reachable in shallow clone — fall back to date-based
    }
  }

  // Date-based fallback
  const gitLog = await repoGit.log({ "--since": lastUpdated });
  return {
    repoUrl: clone.repoUrl,
    relPath: clone.relPath,
    newCommitHash: clone.commitHash,
    commitCount: gitLog.total,
  };
}

async function updateTopicGeneratedSkill(
  skill: GeneratedSkill,
  projectDir: string,
  log: (msg: string) => void,
  aiAgent: AIAgent,
  agentModel?: string,
  agentEffort?: string,
): Promise<UpdateResult> {
  if (!skill.research_query) {
    throw new Error(
      `Generated skill "${skill.name}" is missing both sources and research_query.`,
    );
  }

  await ensureGeneratedSkillSource(projectDir, skill.name);

  const resolvedDocSources = await resolveDocSources(
    skill.doc_urls ?? [],
    projectDir,
  );
  const docUrls = resolvedDocSources.entries;

  log(`Launching ${aiAgent} interactive session...`);
  await runInteractiveAgentSession({
    agent: aiAgent,
    cwd: projectDir,
    prompt: createTopicUpdateSessionPrompt(
      skill.name,
      skill.research_query,
      docUrls.length > 0 ? docUrls : undefined,
    ),
    addDirs: resolvedDocSources.localDirs,
    model: agentModel,
    effort: agentEffort,
  });

  const updatedSkill = await resolveGeneratedSkill({
    projectDir,
    expectedName: skill.name,
  });

  // Capture any sources the agent discovered during update
  const discoveredUrls = await parseSourcesYaml(projectDir, skill.name);
  let newSources: SkillSource[] = [];

  if (discoveredUrls.length > 0) {
    log("Capturing versions from discovered sources...");
    const clones = await cloneRepos(projectDir, discoveredUrls, { depth: 1, log });
    newSources = clones.map((c) => ({ repo: c.repoUrl, commit_hash: c.commitHash }));
    await cleanupClones(clones);
  }

  const today = new Date().toISOString().split("T")[0];
  await installGeneratedSkill({
    skill: updatedSkill,
    projectDir,
    agents: skill.installed_for,
    sources: newSources.length > 0 ? newSources : undefined,
    docUrls: docUrls.length > 0 ? docUrls : undefined,
    researchQuery: skill.research_query,
    installedAt: skill.installed_at,
    lastUpdated: today,
  });

  return {
    name: skill.name,
    type: "generated",
    updated: true,
    reason: "Updated from fresh official-source research",
  };
}

async function updateDocsOnlySkill(
  skill: GeneratedSkill,
  docUrls: string[],
  projectDir: string,
  log: (msg: string) => void,
  aiAgent: AIAgent,
  agentModel?: string,
  agentEffort?: string,
): Promise<UpdateResult> {
  const resolvedDocSources = await resolveDocSources(docUrls, projectDir);

  await ensureGeneratedSkillSource(projectDir, skill.name);

  log(`Launching ${aiAgent} interactive session...`);
  await runInteractiveAgentSession({
    agent: aiAgent,
    cwd: projectDir,
    prompt: createDocsUpdateSessionPrompt(skill.name, resolvedDocSources.entries),
    addDirs: resolvedDocSources.localDirs,
    model: agentModel,
    effort: agentEffort,
  });

  const updatedSkill = await resolveGeneratedSkill({
    projectDir,
    expectedName: skill.name,
  });

  // Capture any sources the agent discovered during update
  const discoveredUrls = await parseSourcesYaml(projectDir, skill.name);
  let newSources: SkillSource[] = [];

  if (discoveredUrls.length > 0) {
    log("Capturing versions from discovered sources...");
    const clones = await cloneRepos(projectDir, discoveredUrls, { depth: 1, log });
    newSources = clones.map((c) => ({ repo: c.repoUrl, commit_hash: c.commitHash }));
    await cleanupClones(clones);
  }

  const today = new Date().toISOString().split("T")[0];
  await installGeneratedSkill({
    skill: updatedSkill,
    projectDir,
    agents: skill.installed_for,
    sources: newSources.length > 0 ? newSources : undefined,
    docUrls: resolvedDocSources.entries,
    researchQuery: skill.research_query,
    installedAt: skill.installed_at,
    lastUpdated: today,
  });

  return {
    name: skill.name,
    type: "generated",
    updated: true,
    reason: "Updated from documentation sources",
  };
}

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
