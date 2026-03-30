import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateProjectIfNeeded } from "../src/core/migration.js";
import { readGlobalRegistry, readRegistry } from "../src/core/tracker.js";

let tempDir: string;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-migration-"));
  process.env.COWBOY_DATA_DIR = join(tempDir, ".cowboy-global");
});

afterEach(async () => {
  delete process.env.COWBOY_DATA_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

describe("migrateProjectIfNeeded", () => {
  it("moves a legacy project-local skill into the global library and replaces local copies with links", async () => {
    const legacySkillDir = join(tempDir, ".cowboy", "skills", "legacy-skill");
    const legacyAgentDir = join(tempDir, ".claude", "skills", "legacy-skill");
    await mkdir(legacySkillDir, { recursive: true });
    await mkdir(join(legacySkillDir, "references"), { recursive: true });
    await writeFile(
      join(legacySkillDir, "SKILL.md"),
      '---\nname: legacy-skill\ndescription: "Legacy skill"\n---\n\n# Legacy\n',
      "utf-8",
    );
    await writeFile(
      join(legacySkillDir, "references", "notes.md"),
      "# Notes\n",
      "utf-8",
    );
    await mkdir(legacyAgentDir, { recursive: true });
    await writeFile(
      join(legacyAgentDir, "SKILL.md"),
      '---\nname: legacy-skill\ndescription: "Legacy skill"\n---\n\n# Legacy\n',
      "utf-8",
    );
    await writeFile(
      join(tempDir, ".cowboy", "installed.yaml"),
      [
        "skills:",
        "  - name: legacy-skill",
        "    type: imported",
        "    source_repo: https://github.com/test/legacy",
        "    source_path: skills/legacy-skill/SKILL.md",
        "    content_hash: sha256:testhash",
        "    installed_at: 2026-03-01",
        "    installed_for:",
        "      - claude",
        "    disabled_for: []",
        "",
      ].join("\n"),
      "utf-8",
    );

    await migrateProjectIfNeeded(tempDir);

    const globalSkillPath = join(process.env.COWBOY_DATA_DIR!, "skills", "legacy-skill", "SKILL.md");
    expect(await exists(globalSkillPath)).toBe(true);
    expect(await readFile(globalSkillPath, "utf-8")).toContain("name: legacy-skill");

    const localCanonicalDir = join(tempDir, ".cowboy", "skills", "legacy-skill");
    const localAgentLink = join(tempDir, ".claude", "skills", "legacy-skill");
    expect((await lstat(localCanonicalDir)).isSymbolicLink()).toBe(true);
    expect((await lstat(localAgentLink)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(localCanonicalDir, "references", "notes.md"), "utf-8")).toContain("# Notes");

    const projectRegistry = await readRegistry(tempDir);
    expect(projectRegistry.skills).toHaveLength(1);
    expect(projectRegistry.skills[0].name).toBe("legacy-skill");

    const globalRegistry = await readGlobalRegistry();
    expect(globalRegistry.skills).toHaveLength(1);
    expect(globalRegistry.skills[0].linked_projects).toEqual([tempDir]);
  });
});
