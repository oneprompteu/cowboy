import simpleGit from "simple-git";
import matter from "gray-matter";
import { readFile, readdir, stat, mkdtemp, rm } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { SkillFrontmatterSchema, type ScannedSkill, type SkillFile } from "./schemas.js";

/**
 * Scan a GitHub repo URL for SKILL.md files.
 * Clones shallow, finds all SKILL.md, parses frontmatter, returns list.
 */
export async function scanRepo(repoUrl: string): Promise<ScannedSkill[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "cowboy-scan-"));

  try {
    const git = simpleGit();
    await git.clone(repoUrl, tempDir, ["--depth", "1"]);
    return await scanDirectory(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Scan a local directory for SKILL.md files.
 * Useful for testing and for scanning already-cloned repos.
 */
export async function scanDirectory(dir: string): Promise<ScannedSkill[]> {
  const skillFiles = await findSkillFiles(dir);
  const skillsByName = new Map<string, ScannedSkill>();

  for (const filePath of skillFiles) {
    const skill = await parseSkillFile(filePath, dir);
    if (skill && !skillsByName.has(skill.name)) {
      skillsByName.set(skill.name, skill);
    }
  }

  return Array.from(skillsByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Recursively find all SKILL.md files in a directory.
 * Skips .git, node_modules, and other common non-content directories.
 */
async function findSkillFiles(dir: string): Promise<string[]> {
  const skipDirs = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    ".cowboy",
  ]);
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.name === "SKILL.md") {
        results.push(join(currentDir, entry.name));
        continue;
      }

      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (entry.isSymbolicLink()) {
        let linkedStats;
        try {
          linkedStats = await stat(fullPath);
        } catch {
          continue;
        }

        if (linkedStats.isDirectory() && !skipDirs.has(entry.name)) {
          await walk(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Parse a single SKILL.md file and extract frontmatter + body.
 * Also collects all companion files in the skill's directory.
 * Returns null if the file can't be parsed or has invalid frontmatter.
 */
async function parseSkillFile(
  filePath: string,
  rootDir: string,
): Promise<ScannedSkill | null> {
  try {
    const rawContent = await readFile(filePath, "utf-8");
    const { data, content: body } = matter(rawContent);

    const frontmatterResult = SkillFrontmatterSchema.safeParse(data);
    if (!frontmatterResult.success) {
      return null;
    }

    const frontmatter = frontmatterResult.data;
    const skillDir = dirname(filePath);

    // Collect companion files (everything in the skill directory except SKILL.md)
    const files = await collectSkillFiles(skillDir);

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      rawContent,
      body: body.trim(),
      relativePath: relative(rootDir, filePath),
      frontmatter,
      files: files.length > 0 ? files : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Recursively collect all files in a skill directory except SKILL.md.
 * Returns file contents as Buffers to support both text and binary files.
 */
async function collectSkillFiles(skillDir: string): Promise<SkillFile[]> {
  const skipNames = new Set([
    "SKILL.md",
    ".git",
    "node_modules",
    "__pycache__",
    ".DS_Store",
  ]);
  const files: SkillFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;

      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        files.push({
          relativePath: relative(skillDir, fullPath),
          content,
        });
      } else if (entry.isSymbolicLink()) {
        let linkedStats;
        try {
          linkedStats = await stat(fullPath);
        } catch {
          continue;
        }

        if (linkedStats.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        if (linkedStats.isFile()) {
          const content = await readFile(fullPath);
          files.push({
            relativePath: relative(skillDir, fullPath),
            content,
          });
        }
      }
    }
  }

  await walk(skillDir);
  return files;
}
