import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installGeneratedSkill, installSkill, uninstallSkill, disableSkill, enableSkill } from "../src/core/installer.js";
import { readRegistry } from "../src/core/tracker.js";
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-installer-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("installSkill", () => {
  it("installs for claude only", async () => {
    const results = await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sourceRepo: "https://github.com/test/repo",
    });

    expect(results).toHaveLength(1);
    expect(results[0].agent).toBe("claude");

    // Verify file exists
    const skillPath = join(
      tempDir,
      ".claude",
      "skills",
      "tdd-workflow",
      "SKILL.md",
    );
    expect(await exists(skillPath)).toBe(true);

    // Verify tracking
    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].name).toBe("tdd-workflow");
    expect(registry.skills[0].type).toBe("imported");
  });

  it("installs for both agents simultaneously", async () => {
    const results = await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    expect(results).toHaveLength(2);

    // Claude Code files
    expect(
      await exists(
        join(tempDir, ".claude", "skills", "tdd-workflow", "SKILL.md"),
      ),
    ).toBe(true);

    // Codex files
    expect(
      await exists(
        join(tempDir, ".agents", "skills", "tdd-workflow", "SKILL.md"),
      ),
    ).toBe(true);
    // Tracking
    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].installed_for).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("tracks source repo and content hash", async () => {
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sourceRepo: "https://github.com/affaan-m/everything-claude-code",
    });

    const registry = await readRegistry(tempDir);
    const tracked = registry.skills[0];

    expect(tracked.type).toBe("imported");
    if (tracked.type === "imported") {
      expect(tracked.source_repo).toBe(
        "https://github.com/affaan-m/everything-claude-code",
      );
      expect(tracked.source_path).toBe("skills/tdd-workflow/SKILL.md");
      expect(tracked.content_hash).toMatch(/^sha256:/);
    }
  });

  it("replaces existing skill on reinstall", async () => {
    // Install twice
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sourceRepo: "https://github.com/test/repo",
    });
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    const registry = await readRegistry(tempDir);
    // Should only have one entry, not duplicated
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].installed_for).toEqual([
      "claude",
      "codex",
    ]);
  });
});

describe("uninstallSkill", () => {
  it("removes skill files and tracking", async () => {
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    const removed = await uninstallSkill("tdd-workflow", tempDir);

    expect(removed).toBe(true);

    // Files should be gone
    expect(
      await exists(join(tempDir, ".claude", "skills", "tdd-workflow")),
    ).toBe(false);
    expect(
      await exists(join(tempDir, ".agents", "skills", "tdd-workflow")),
    ).toBe(false);

    // Tracking should be clean
    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(0);
  });

  it("returns false for non-existent skill", async () => {
    const removed = await uninstallSkill("non-existent", tempDir);
    expect(removed).toBe(false);
  });

  it("removes the canonical generated skill source", async () => {
    await mkdir(join(tempDir, ".cowboy", "skills", "tdd-workflow"), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, ".cowboy", "skills", "tdd-workflow", "SKILL.md"),
      mockSkill.rawContent,
      "utf-8",
    );

    await installGeneratedSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib" }],
    });

    const removed = await uninstallSkill("tdd-workflow", tempDir);

    expect(removed).toBe(true);
    expect(
      await exists(join(tempDir, ".cowboy", "skills", "tdd-workflow")),
    ).toBe(false);
  });
});

describe("disableSkill / enableSkill", () => {
  it("disables a skill for a specific agent", async () => {
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    const result = await disableSkill("tdd-workflow", tempDir, "codex");
    expect(result).not.toBeNull();
    expect(result!.disabled_for).toEqual(["codex"]);

    // Files removed from codex
    expect(
      await exists(join(tempDir, ".agents", "skills", "tdd-workflow")),
    ).toBe(false);
    // Files still present for claude
    expect(
      await exists(join(tempDir, ".claude", "skills", "tdd-workflow", "SKILL.md")),
    ).toBe(true);
  });

  it("disables a skill for all agents", async () => {
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    const result = await disableSkill("tdd-workflow", tempDir);
    expect(result!.disabled_for).toEqual(["claude", "codex"]);

    expect(
      await exists(join(tempDir, ".claude", "skills", "tdd-workflow")),
    ).toBe(false);
    expect(
      await exists(join(tempDir, ".agents", "skills", "tdd-workflow")),
    ).toBe(false);

    // Registry still has the skill
    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);
  });

  it("enables a previously disabled skill", async () => {
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    await disableSkill("tdd-workflow", tempDir, "codex");
    const result = await enableSkill("tdd-workflow", tempDir, "codex");

    expect(result!.disabled_for).toEqual([]);
    expect(
      await exists(join(tempDir, ".agents", "skills", "tdd-workflow", "SKILL.md")),
    ).toBe(true);
  });

  it("enables all disabled agents at once", async () => {
    await installSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude", "codex"],
      sourceRepo: "https://github.com/test/repo",
    });

    await disableSkill("tdd-workflow", tempDir);
    const result = await enableSkill("tdd-workflow", tempDir);

    expect(result!.disabled_for).toEqual([]);
    expect(
      await exists(join(tempDir, ".claude", "skills", "tdd-workflow", "SKILL.md")),
    ).toBe(true);
    expect(
      await exists(join(tempDir, ".agents", "skills", "tdd-workflow", "SKILL.md")),
    ).toBe(true);
  });

  it("returns null for non-existent skill", async () => {
    expect(await disableSkill("nope", tempDir)).toBeNull();
    expect(await enableSkill("nope", tempDir)).toBeNull();
  });

  it("works with generated skills", async () => {
    await installGeneratedSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib" }],
    });

    await disableSkill("tdd-workflow", tempDir);
    expect(
      await exists(join(tempDir, ".claude", "skills", "tdd-workflow")),
    ).toBe(false);

    await enableSkill("tdd-workflow", tempDir);
    expect(
      await exists(join(tempDir, ".claude", "skills", "tdd-workflow", "SKILL.md")),
    ).toBe(true);
  });
});

describe("installGeneratedSkill with doc_urls", () => {
  it("persists doc_urls in the registry", async () => {
    await installGeneratedSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      docUrls: ["https://docs.example.com"],
    });

    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);
    expect(registry.skills[0].type).toBe("generated");

    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].doc_urls).toEqual(["https://docs.example.com"]);
    }
  });

  it("persists both sources and doc_urls", async () => {
    await installGeneratedSkill({
      skill: mockSkill,
      projectDir: tempDir,
      agents: ["claude"],
      sources: [{ repo: "https://github.com/test/lib", commit_hash: "abc123" }],
      docUrls: ["https://docs.example.com"],
    });

    const registry = await readRegistry(tempDir);
    expect(registry.skills).toHaveLength(1);

    if (registry.skills[0].type === "generated") {
      expect(registry.skills[0].sources).toEqual([
        { repo: "https://github.com/test/lib", commit_hash: "abc123" },
      ]);
      expect(registry.skills[0].doc_urls).toEqual(["https://docs.example.com"]);
    }
  });
});
