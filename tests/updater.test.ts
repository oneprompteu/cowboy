import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

describe("updateSkills", () => {
  it("updates generated skills in place and preserves installed_at", async () => {
    const installedAt = "2026-03-01";
    const previousLastUpdated = "2026-03-05";
    const today = new Date().toISOString().split("T")[0];

    await installGeneratedSkill({
      skill: originalSkill,
      projectDir: tempDir,
      agents: ["claude"],
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
      expect(registry.skills[0].installed_for).toEqual(["claude"]);
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
});
