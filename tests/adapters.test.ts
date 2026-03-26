import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeAdapter } from "../src/core/adapters/claude-code.js";
import { CodexAdapter } from "../src/core/adapters/codex.js";
import type { ScannedSkill } from "../src/core/schemas.js";

let tempDir: string;

const mockSkill: ScannedSkill = {
  name: "tdd-workflow",
  description: "Red-Green-Refactor TDD workflow",
  rawContent:
    '---\nname: tdd-workflow\ndescription: "Red-Green-Refactor TDD workflow"\n---\n\n# TDD Workflow\n\nWrite tests first.',
  body: "# TDD Workflow\n\nWrite tests first.",
  relativePath: "skills/tdd-workflow/SKILL.md",
  frontmatter: {
    name: "tdd-workflow",
    description: "Red-Green-Refactor TDD workflow",
  },
};

const mockMultiFileSkill: ScannedSkill = {
  name: "pdf-editor",
  description: "PDF editing tools",
  rawContent:
    '---\nname: pdf-editor\ndescription: "PDF editing tools"\n---\n\n# PDF Editor',
  body: "# PDF Editor",
  relativePath: "skills/pdf-editor/SKILL.md",
  frontmatter: {
    name: "pdf-editor",
    description: "PDF editing tools",
  },
  files: [
    { relativePath: "scripts/rotate.py", content: Buffer.from("import pdf\nrotate()") },
    { relativePath: "references/api.md", content: Buffer.from("# PDF API Docs") },
  ],
};

const mockSkillWithCodexMetadata: ScannedSkill = {
  name: "deepagents",
  description: "Deep Agents library skill",
  rawContent:
    '---\nname: deepagents\ndescription: "Deep Agents library skill"\n---\n\n# DeepAgents',
  body: "# DeepAgents",
  relativePath: "skills/deepagents/SKILL.md",
  frontmatter: {
    name: "deepagents",
    description: "Deep Agents library skill",
  },
  files: [
    {
      relativePath: "agents/openai.yaml",
      content: Buffer.from(
        "interface:\n  display_name: DeepAgents\n  short_description: Deep Agents library skill\n  default_prompt: Use the deepagents skill\npolicy:\n  allow_implicit_invocation: true\n",
      ),
    },
    { relativePath: "references/patterns.md", content: Buffer.from("# Patterns") },
  ],
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-adapters-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  it("installs SKILL.md to .claude/skills/{name}/", async () => {
    const result = await adapter.install(mockSkill, tempDir);

    const skillPath = join(
      tempDir,
      ".claude",
      "skills",
      "tdd-workflow",
      "SKILL.md",
    );
    expect(await exists(skillPath)).toBe(true);

    const content = await readFile(skillPath, "utf-8");
    expect(content).toBe(mockSkill.rawContent);

    expect(result.agent).toBe("claude");
    expect(result.skillName).toBe("tdd-workflow");
    expect(result.files).toContain(skillPath);
  });

  it("removes skill directory", async () => {
    await adapter.install(mockSkill, tempDir);
    const skillDir = join(tempDir, ".claude", "skills", "tdd-workflow");
    expect(await exists(skillDir)).toBe(true);

    await adapter.remove("tdd-workflow", tempDir);
    expect(await exists(skillDir)).toBe(false);
  });

  it("installs companion files preserving directory structure", async () => {
    const result = await adapter.install(mockMultiFileSkill, tempDir);

    const skillDir = join(tempDir, ".claude", "skills", "pdf-editor");

    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);

    const scriptPath = join(skillDir, "scripts", "rotate.py");
    expect(await exists(scriptPath)).toBe(true);
    const scriptContent = await readFile(scriptPath, "utf-8");
    expect(scriptContent).toBe("import pdf\nrotate()");

    const refPath = join(skillDir, "references", "api.md");
    expect(await exists(refPath)).toBe(true);
    const refContent = await readFile(refPath, "utf-8");
    expect(refContent).toBe("# PDF API Docs");

    expect(result.files.length).toBe(3);
  });

  it("skips Codex-only metadata files", async () => {
    const result = await adapter.install(mockSkillWithCodexMetadata, tempDir);
    const skillDir = join(tempDir, ".claude", "skills", "deepagents");

    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
    expect(await exists(join(skillDir, "references", "patterns.md"))).toBe(true);
    expect(await exists(join(skillDir, "agents", "openai.yaml"))).toBe(false);
    expect(result.files).toHaveLength(2);
  });
});

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  it("installs SKILL.md to .agents/skills/{name}/", async () => {
    const result = await adapter.install(mockSkill, tempDir);

    const skillPath = join(
      tempDir,
      ".agents",
      "skills",
      "tdd-workflow",
      "SKILL.md",
    );
    expect(await exists(skillPath)).toBe(true);

    const content = await readFile(skillPath, "utf-8");
    expect(content).toBe(mockSkill.rawContent);

    expect(result.agent).toBe("codex");
    expect(result.skillName).toBe("tdd-workflow");
  });

  it("auto-generates agents/openai.yaml when the skill does not include it", async () => {
    await adapter.install(mockSkill, tempDir);

    const yamlPath = join(
      tempDir,
      ".agents",
      "skills",
      "tdd-workflow",
      "agents",
      "openai.yaml",
    );
    expect(await exists(yamlPath)).toBe(true);
    const content = await readFile(yamlPath, "utf-8");
    expect(content).toContain("display_name: Tdd Workflow");
    expect(content).toContain("short_description: Red-Green-Refactor TDD workflow");
    expect(content).toContain("allow_implicit_invocation: true");
  });

  it("replaces stale agents/openai.yaml with auto-generated one on reinstall", async () => {
    const yamlPath = join(
      tempDir,
      ".agents",
      "skills",
      "tdd-workflow",
      "agents",
      "openai.yaml",
    );
    await mkdir(join(tempDir, ".agents", "skills", "tdd-workflow", "agents"), {
      recursive: true,
    });
    await writeFile(yamlPath, "legacy: true\n", "utf-8");

    await adapter.install(mockSkill, tempDir);

    expect(await exists(yamlPath)).toBe(true);
    const content = await readFile(yamlPath, "utf-8");
    expect(content).not.toContain("legacy");
    expect(content).toContain("display_name: Tdd Workflow");
  });

  it("removes skill directory including agents/", async () => {
    await adapter.install(mockSkill, tempDir);
    const skillDir = join(tempDir, ".agents", "skills", "tdd-workflow");
    expect(await exists(skillDir)).toBe(true);

    await adapter.remove("tdd-workflow", tempDir);
    expect(await exists(skillDir)).toBe(false);
  });

  it("installs companion files alongside SKILL.md", async () => {
    const result = await adapter.install(mockMultiFileSkill, tempDir);

    const skillDir = join(tempDir, ".agents", "skills", "pdf-editor");

    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);

    expect(await exists(join(skillDir, "scripts", "rotate.py"))).toBe(true);
    expect(await exists(join(skillDir, "references", "api.md"))).toBe(true);
    expect(await exists(join(skillDir, "agents", "openai.yaml"))).toBe(true);

    expect(result.files.length).toBe(4);
  });

  it("preserves agents/openai.yaml when the canonical skill includes it", async () => {
    await adapter.install(mockSkillWithCodexMetadata, tempDir);

    const yamlPath = join(
      tempDir,
      ".agents",
      "skills",
      "deepagents",
      "agents",
      "openai.yaml",
    );
    const refPath = join(
      tempDir,
      ".agents",
      "skills",
      "deepagents",
      "references",
      "patterns.md",
    );

    expect(await exists(yamlPath)).toBe(true);
    expect(await readFile(yamlPath, "utf-8")).toContain("display_name: DeepAgents");
    expect(await exists(refPath)).toBe(true);
  });
});
