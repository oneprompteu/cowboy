import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanDirectory } from "../src/core/scanner.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-scanner-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeSkill(
  dir: string,
  name: string,
  description: string,
  body: string = "# Content",
): Promise<void> {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n${body}`,
  );
}

describe("scanDirectory", () => {
  it("finds SKILL.md files in nested directories", async () => {
    await writeSkill(join(tempDir, "skills"), "tdd-workflow", "TDD workflow");
    await writeSkill(
      join(tempDir, "skills"),
      "security-review",
      "Security review",
    );

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual([
      "security-review",
      "tdd-workflow",
    ]);
  });

  it("extracts frontmatter correctly", async () => {
    await writeSkill(
      join(tempDir, "skills"),
      "api-design",
      "REST API design patterns",
      "# API Design\n\n## Best Practices\n\nUse REST conventions.",
    );

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("api-design");
    expect(skills[0].description).toBe("REST API design patterns");
    expect(skills[0].body).toContain("# API Design");
    expect(skills[0].relativePath).toBe(
      join("skills", "api-design", "SKILL.md"),
    );
  });

  it("skips SKILL.md without valid frontmatter", async () => {
    // Valid skill
    await writeSkill(join(tempDir, "skills"), "good-skill", "A good skill");

    // Invalid skill (no name)
    const badDir = join(tempDir, "skills", "bad-skill");
    await mkdir(badDir, { recursive: true });
    await writeFile(
      join(badDir, "SKILL.md"),
      "---\ndescription: missing name\n---\n\n# Bad",
    );

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("good-skill");
  });

  it("skips .git and node_modules directories", async () => {
    await writeSkill(join(tempDir, "skills"), "real-skill", "Real skill");

    // These should be skipped
    const gitSkillDir = join(tempDir, ".git", "skills", "hidden");
    await mkdir(gitSkillDir, { recursive: true });
    await writeFile(
      join(gitSkillDir, "SKILL.md"),
      '---\nname: hidden\ndescription: "hidden"\n---\n\n# Hidden',
    );

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("real-skill");
  });

  it("returns empty array for directory with no skills", async () => {
    const skills = await scanDirectory(tempDir);
    expect(skills).toEqual([]);
  });

  it("handles deeply nested skill files", async () => {
    await writeSkill(
      join(tempDir, "a", "b", "c", "skills"),
      "deep-skill",
      "Deep skill",
    );

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("deep-skill");
  });

  it("collects companion files from skill directory", async () => {
    // Create a multi-file skill
    await writeSkill(join(tempDir, "skills"), "pdf-editor", "PDF editor skill");

    const skillDir = join(tempDir, "skills", "pdf-editor");
    const scriptsDir = join(skillDir, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(join(scriptsDir, "rotate.py"), "import pdf\n# rotate logic");
    await writeFile(join(scriptsDir, "extract.py"), "import pdf\n# extract logic");

    const refsDir = join(skillDir, "references");
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, "api-docs.md"), "# PDF API Docs");

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].files).toBeDefined();
    expect(skills[0].files!.length).toBe(3);

    const paths = skills[0].files!.map((f) => f.relativePath).sort();
    expect(paths).toEqual([
      join("references", "api-docs.md"),
      join("scripts", "extract.py"),
      join("scripts", "rotate.py"),
    ]);

    // Check content is buffered
    const rotateFile = skills[0].files!.find((f) => f.relativePath.includes("rotate.py"));
    expect(rotateFile!.content.toString("utf-8")).toContain("import pdf");
  });

  it("returns no files for single-file skill", async () => {
    await writeSkill(join(tempDir, "skills"), "simple-skill", "Simple skill");

    const skills = await scanDirectory(tempDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].files).toBeUndefined();
  });

  it("skips __pycache__ and .DS_Store in companion files", async () => {
    await writeSkill(join(tempDir, "skills"), "py-skill", "Python skill");

    const skillDir = join(tempDir, "skills", "py-skill");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "scripts", "main.py"), "print('hello')");
    await mkdir(join(skillDir, "__pycache__"), { recursive: true });
    await writeFile(join(skillDir, "__pycache__", "main.cpython-39.pyc"), "bytecode");
    await writeFile(join(skillDir, ".DS_Store"), "mac metadata");

    const skills = await scanDirectory(tempDir);

    expect(skills[0].files).toBeDefined();
    expect(skills[0].files!.length).toBe(1);
    expect(skills[0].files![0].relativePath).toBe(join("scripts", "main.py"));
  });
});
