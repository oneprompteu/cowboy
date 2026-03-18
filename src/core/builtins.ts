import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScannedSkill, SkillFile } from "./schemas.js";
import matter from "gray-matter";
import { SkillFrontmatterSchema } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the built-in skills directory (src/skills/ in dev, dist/skills/ in prod) */
function getBuiltinSkillsDir(): string {
  // __dirname is either src/core/ or dist/core/ — go up one level to src/ or dist/
  return join(__dirname, "..", "skills");
}

/**
 * Load all built-in skills that ship with Cowboy.
 * These are installed automatically during `cowboy init`.
 */
export async function loadBuiltinSkills(): Promise<ScannedSkill[]> {
  const skillsDir = getBuiltinSkillsDir();
  const skills: ScannedSkill[] = [];

  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return []; // No built-in skills directory
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(skillsDir, entry.name);
    const skillMdPath = join(skillDir, "SKILL.md");

    try {
      const rawContent = await readFile(skillMdPath, "utf-8");
      const { data, content: body } = matter(rawContent);

      const result = SkillFrontmatterSchema.safeParse(data);
      if (!result.success) continue;

      const frontmatter = result.data;
      const files = await collectFiles(skillDir);

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        rawContent,
        body: body.trim(),
        relativePath: `builtins/${frontmatter.name}/SKILL.md`,
        frontmatter,
        files: files.length > 0 ? files : undefined,
      });
    } catch {
      // Skip invalid built-in skills
    }
  }

  return skills;
}

async function collectFiles(skillDir: string): Promise<SkillFile[]> {
  const skipNames = new Set(["SKILL.md", ".DS_Store"]);
  const files: SkillFile[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push({
          relativePath: relative(skillDir, fullPath),
          content: await readFile(fullPath),
        });
      }
    }
  }

  await walk(skillDir);
  return files;
}
