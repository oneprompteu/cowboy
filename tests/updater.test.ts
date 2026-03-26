import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { cloneMock, logMock, revparseMock, diffMock, sessionMock } = vi.hoisted(() => ({
  cloneMock: vi.fn(),
  logMock: vi.fn(),
  revparseMock: vi.fn(),
  diffMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock("simple-git", () => ({
  default: vi.fn((dir?: string) => (
    dir
      ? { log: logMock, revparse: revparseMock, diff: diffMock }
      : { clone: cloneMock }
  )),
}));

vi.mock("../src/core/ai-bridge.js", () => ({
  runInteractiveAgentSession: sessionMock,
}));

import { installGeneratedSkill } from "../src/core/installer.js";
import { readRegistry } from "../src/core/tracker.js";
import { updateSkills } from "../src/core/updater.js";
import type { ScannedSkill } from "../src/core/schemas.js";

let tempDir: string;

const originalSkill: ScannedSkill = {
  name: "test-skill",
  description: "Original generated skill",
  rawContent:
    '---\nname: test-skill\ndescription: "Original generated skill"\n---\n\n# Test Skill\n\nOriginal content.',
  body: "# Test Skill\n\nOriginal content.",
  relativePath: "test-skill/SKILL.md",
  frontmatter: {
    name: "test-skill",
    description: "Original generated skill",
  },
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-updater-"));
  cloneMock.mockReset();
  logMock.mockReset();
  revparseMock.mockReset();
  diffMock.mockReset();
  sessionMock.mockReset();
  revparseMock.mockResolvedValue("newcommithash123\n");
  cloneMock.mockResolvedValue(undefined);
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

describe("updateSkills", () => {
  it("updates generated skills in place and preserves installed_at", async () => {
    const installedAt = "2026-03-01";
    const previousLastUpdated = "2026-03-05";
    const today = new Date().toISOString().split("T")[0];

    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sources: [{ repo: "https://github.com/test/lib" }],
      installedAt,
      lastUpdated: previousLastUpdated,
    });

    logMock.mockResolvedValue({
      total: 1,
      all: [{ message: "Update the library docs" }],
    });

    sessionMock.mockImplementation(async ({ cwd }: { cwd: string }) => {
      const skillDir = join(cwd, ".cowboy", "skills", "test-skill");
      await mkdir(join(skillDir, "references"), { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: test-skill\ndescription: "Updated generated skill"\n---\n\n# Test Skill\n\nUpdated content.',
        "utf-8",
      );
      await writeFile(
        join(skillDir, "references", "notes.md"),
        "# Notes\n\nUpdated reference.",
        "utf-8",
      );
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "claude",
    });

    expect(results).toHaveLength(1);
    expect(results[0].updated).toBe(true);
    expect(sessionMock).toHaveBeenCalledOnce();

    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].type).toBe("generated");

    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].installed_at).toBe(installedAt);
      expect(registry.skills[0].last_updated).toBe(today);
      expect(registry.skills[0].installed_for).toEqual(["claude", "codex"]);
      expect(registry.skills[0].sources).toEqual([
        { repo: "https://github.com/test/lib", commit_hash: "newcommithash123" },
      ]);
    }

    expect(
      await readFile(
        join(tempDir, ".cowboy", "skills", "test-skill", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("Updated generated skill");
    expect(
      await readFile(
        join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("Updated generated skill");
    expect(
      await readFile(
        join(tempDir, ".agents", "skills", "test-skill", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("Updated generated skill");
    expect(
      await readFile(
        join(
          tempDir,
          ".cowboy",
          "skills",
          "test-skill",
          "references",
          "notes.md",
        ),
        "utf-8",
      ),
    ).toContain("Updated reference");
  });

  it("skips the interactive session when the library has no new commits", async () => {
    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib" }],
      installedAt: "2026-03-01",
      lastUpdated: "2026-03-05",
    });

    logMock.mockResolvedValue({
      total: 0,
      all: [],
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "claude",
    });

    expect(results).toHaveLength(1);
    expect(results[0].updated).toBe(false);
    expect(results[0].reason).toBe("No changes in library repo");
    expect(sessionMock).not.toHaveBeenCalled();
  });

  it("updates topic-generated skills from fresh research without cloning a repo", async () => {
    const installedAt = "2026-03-01";
    const today = new Date().toISOString().split("T")[0];

    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["codex"],
      researchQuery: "langchain",
      installedAt,
      lastUpdated: "2026-03-05",
    });

    sessionMock.mockImplementation(async ({ cwd, prompt }: {
      cwd: string;
      prompt: string;
    }) => {
      expect(prompt).toContain("langchain");

      const skillDir = join(cwd, ".cowboy", "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: test-skill\ndescription: "Updated from research"\n---\n\n# Test Skill\n\nFresh research.',
        "utf-8",
      );
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "codex",
    });

    expect(results).toHaveLength(1);
    expect(results[0].updated).toBe(true);
    expect(results[0].reason).toBe("Updated from fresh official-source research");
    expect(cloneMock).not.toHaveBeenCalled();

    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].type).toBe("generated");

    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].installed_at).toBe(installedAt);
      expect(registry.skills[0].last_updated).toBe(today);
      expect(registry.skills[0].research_query).toBe("langchain");
      expect(registry.skills[0].sources).toBeUndefined();
      expect(registry.skills[0].installed_for).toEqual(["codex"]);
    }
  });

  it("passes diff summary to the agent when commit_hash is stored", async () => {
    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib", commit_hash: "aaa111bbb222" }],
      installedAt: "2026-03-01",
      lastUpdated: "2026-03-05",
    });

    diffMock.mockResolvedValue(" 2 files changed, 10 insertions(+), 3 deletions(-)\n");
    logMock.mockResolvedValue({
      total: 2,
      all: [
        { hash: "bbb222ccc333aaa", message: "Fix API docs" },
        { hash: "ccc333ddd444bbb", message: "Add new endpoint" },
      ],
    });

    sessionMock.mockImplementation(async ({ cwd, prompt }: { cwd: string; prompt: string }) => {
      expect(prompt).toContain("2 commit(s) since aaa111b");
      expect(prompt).toContain("Fix API docs");
      expect(prompt).toContain("Add new endpoint");
      expect(prompt).toContain("10 insertions");

      const skillDir = join(cwd, ".cowboy", "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: test-skill\ndescription: "Diff updated"\n---\n\n# Updated',
        "utf-8",
      );
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "claude",
    });

    expect(results[0].updated).toBe(true);

    const registry = await readRegistry(tempDir);
    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].sources).toEqual([
        { repo: "https://github.com/test/lib", commit_hash: "newcommithash123" },
      ]);
    }
  });

  it("falls back to date-based detection when stored hash is unreachable", async () => {
    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib", commit_hash: "old_unreachable_hash" }],
      installedAt: "2026-03-01",
      lastUpdated: "2026-03-05",
    });

    diffMock.mockRejectedValue(new Error("bad revision"));
    logMock.mockImplementation((args: any) => {
      // Date-based fallback path
      if (args?.["--since"]) {
        return Promise.resolve({ total: 1, all: [{ message: "Some change" }] });
      }
      // Hash-range path (should not be called after diff fails, but just in case)
      return Promise.reject(new Error("bad revision"));
    });

    sessionMock.mockImplementation(async ({ cwd, prompt }: { cwd: string; prompt: string }) => {
      expect(prompt).not.toContain("commit(s) since");

      const skillDir = join(cwd, ".cowboy", "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: test-skill\ndescription: "Fallback updated"\n---\n\n# Fallback',
        "utf-8",
      );
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "claude",
    });

    expect(results[0].updated).toBe(true);

    const registry = await readRegistry(tempDir);
    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].sources).toEqual([
        { repo: "https://github.com/test/lib", commit_hash: "newcommithash123" },
      ]);
    }
  });

  it("updates docs-only generated skill by re-running agent", async () => {
    const today = new Date().toISOString().split("T")[0];
    const localDocsDir = join(tempDir, "docs");
    await mkdir(localDocsDir, { recursive: true });

    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude"],
      docUrls: ["https://docs.example.com", localDocsDir],
      installedAt: "2026-03-01",
      lastUpdated: "2026-03-05",
    });

    sessionMock.mockImplementation(async ({ cwd, prompt, addDirs }: {
      cwd: string;
      prompt: string;
      addDirs?: string[];
    }) => {
      expect(prompt).toContain("https://docs.example.com");
      expect(prompt).toContain(localDocsDir);
      expect(addDirs).toEqual([localDocsDir]);

      const skillDir = join(cwd, ".cowboy", "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: test-skill\ndescription: "Updated from docs"\n---\n\n# Updated',
        "utf-8",
      );
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "claude",
    });

    expect(results).toHaveLength(1);
    expect(results[0].updated).toBe(true);
    expect(results[0].reason).toBe("Updated from documentation sources");
    expect(cloneMock).not.toHaveBeenCalled();

    const registry = await readRegistry(tempDir);
    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].installed_at).toBe("2026-03-01");
      expect(registry.skills[0].last_updated).toBe(today);
      expect(registry.skills[0].doc_urls).toEqual(["https://docs.example.com", localDocsDir]);
    }
  });

  it("includes doc_urls in sourced skill update prompt", async () => {
    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib" }],
      docUrls: ["https://docs.example.com"],
      installedAt: "2026-03-01",
      lastUpdated: "2026-03-05",
    });

    logMock.mockResolvedValue({
      total: 1,
      all: [{ message: "Update docs" }],
    });

    sessionMock.mockImplementation(async ({ cwd, prompt }: { cwd: string; prompt: string }) => {
      expect(prompt).toContain("https://docs.example.com");

      const skillDir = join(cwd, ".cowboy", "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: test-skill\ndescription: "Updated"\n---\n\n# Updated',
        "utf-8",
      );
    });

    const results = await updateSkills({
      projectDir: tempDir,
      aiAgent: "claude",
    });

    expect(results[0].updated).toBe(true);

    const registry = await readRegistry(tempDir);
    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].doc_urls).toEqual(["https://docs.example.com"]);
    }
  });

  it("keeps imported skills scoped to their recorded install targets during update", async () => {
    await mkdir(join(tempDir, ".agents"), { recursive: true });

    const importedSkill: ScannedSkill = {
      name: "imported-skill",
      description: "Imported skill",
      rawContent:
        '---\nname: imported-skill\ndescription: "Imported skill"\n---\n\n# Imported Skill\n\nOriginal content.',
      body: "# Imported Skill\n\nOriginal content.",
      relativePath: "skills/imported-skill/SKILL.md",
      frontmatter: {
        name: "imported-skill",
        description: "Imported skill",
      },
    };

    const { installSkill } = await import("../src/core/installer.js");
    await installSkill({
      skill: importedSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sourceRepo: "https://github.com/test/imported-repo",
    });

    cloneMock.mockImplementation(async (_repo: string, dir: string) => {
      await mkdir(join(dir, "skills", "imported-skill"), { recursive: true });
      await writeFile(
        join(dir, "skills", "imported-skill", "SKILL.md"),
        '---\nname: imported-skill\ndescription: "Imported skill updated"\n---\n\n# Imported Skill\n\nUpdated content.',
        "utf-8",
      );
    });

    const results = await updateSkills({ projectDir: tempDir });

    expect(results).toHaveLength(1);
    expect(results[0].updated).toBe(true);

    const registry = await readRegistry(tempDir);
    expect(registry.skills[0].installed_for).toEqual(["claude"]);

    expect(
      await exists(join(tempDir, ".claude", "skills", "imported-skill", "SKILL.md")),
    ).toBe(true);
    expect(
      await exists(join(tempDir, ".agents", "skills", "imported-skill", "SKILL.md")),
    ).toBe(false);
  });
});
