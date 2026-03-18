import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createRepoGenerationSessionPrompt,
  createRepoUpdateSessionPrompt,
  createMultiRepoGenerationSessionPrompt,
  createMultiSourceUpdateSessionPrompt,
  createTopicGenerationSessionPrompt,
  ensureGeneratedSkillSource,
  parseSourcesYaml,
  resolveGeneratedSkill,
  scanGeneratedSkills,
} from "../src/core/generator.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-generator-"));
  await mkdir(join(tempDir, ".cowboy", "skills"), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("resolveGeneratedSkill", () => {
  it("finds the expected named skill in .cowboy/skills", async () => {
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "playwright"),
      "playwright",
      "Playwright helper",
    );

    const skill = await resolveGeneratedSkill({
      projectDir: tempDir,
      expectedName: "playwright",
    });

    expect(skill.name).toBe("playwright");
    expect(skill.relativePath).toBe(join("playwright", "SKILL.md"));
  });

  it("detects exactly one new generated skill when name is not provided", async () => {
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "existing"),
      "existing",
      "Existing skill",
    );

    const previousSkillNames = new Set(["existing"]);

    await writeSkill(
      join(tempDir, ".cowboy", "skills", "new-skill"),
      "new-skill",
      "New skill",
    );

    const skill = await resolveGeneratedSkill({
      projectDir: tempDir,
      previousSkillNames,
    });

    expect(skill.name).toBe("new-skill");
  });

  it("throws when no new valid skill is created", async () => {
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "existing"),
      "existing",
      "Existing skill",
    );

    await expect(() =>
      resolveGeneratedSkill({
        projectDir: tempDir,
        previousSkillNames: new Set(["existing"]),
      }),
    ).rejects.toThrow("No new valid skill");
  });

  it("throws when multiple new skills are created", async () => {
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "one"),
      "one",
      "First skill",
    );
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "two"),
      "two",
      "Second skill",
    );

    await expect(() =>
      resolveGeneratedSkill({
        projectDir: tempDir,
        previousSkillNames: new Set<string>(),
      }),
    ).rejects.toThrow("Expected exactly one new skill");
  });

  it("throws when the directory name does not match the frontmatter name", async () => {
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "wrong-dir"),
      "actual-name",
      "Broken layout",
    );

    await expect(() =>
      resolveGeneratedSkill({
        projectDir: tempDir,
        previousSkillNames: new Set<string>(),
      }),
    ).rejects.toThrow(".cowboy/skills/actual-name/SKILL.md");
  });
});

describe("ensureGeneratedSkillSource", () => {
  it("bootstraps canonical source from an installed Codex skill and strips openai.yaml", async () => {
    const installedDir = join(tempDir, ".agents", "skills", "dbt");
    await writeSkill(installedDir, "dbt", "dbt workflow");
    await mkdir(join(installedDir, "agents"), { recursive: true });
    await writeFile(
      join(installedDir, "agents", "openai.yaml"),
      "interface:\n  display_name: dbt\n",
      "utf-8",
    );
    await mkdir(join(installedDir, "scripts"), { recursive: true });
    await writeFile(
      join(installedDir, "scripts", "run.sh"),
      "#!/bin/sh\necho dbt\n",
      "utf-8",
    );

    await ensureGeneratedSkillSource(tempDir, "dbt");

    const canonicalSkillPath = join(
      tempDir,
      ".cowboy",
      "skills",
      "dbt",
      "SKILL.md",
    );
    const scriptPath = join(
      tempDir,
      ".cowboy",
      "skills",
      "dbt",
      "scripts",
      "run.sh",
    );
    const openaiYamlPath = join(
      tempDir,
      ".cowboy",
      "skills",
      "dbt",
      "agents",
      "openai.yaml",
    );

    expect(await readFile(canonicalSkillPath, "utf-8")).toContain("name: dbt");
    expect(await readFile(scriptPath, "utf-8")).toContain("echo dbt");
    expect(await exists(openaiYamlPath)).toBe(false);

    const skills = await scanGeneratedSkills(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("dbt");
  });
});

describe("generation prompts", () => {
  it("builds a repo prompt that points the agent at .cowboy/skills", () => {
    const prompt = createRepoGenerationSessionPrompt(".cowboy/.tmp/playwright", "playwright");

    expect(prompt).toContain(".cowboy/skills/playwright/");
    expect(prompt).toContain(".cowboy/.tmp/playwright");
    expect(prompt).toContain("skill-creator");
  });

  it("builds a repo update prompt including diff summary when provided", () => {
    const diff = "2 commit(s) since abc1234:\n  abc1234 Fix docs\n  def5678 Add API\n\n 2 files changed, 10 insertions(+), 3 deletions(-)";
    const prompt = createRepoUpdateSessionPrompt("playwright", ".cowboy/.tmp/playwright", diff);

    expect(prompt).toContain('Update the skill "playwright"');
    expect(prompt).toContain("2 commit(s) since abc1234");
    expect(prompt).toContain("10 insertions");
  });

  it("builds a repo update prompt without diff summary for fallback", () => {
    const prompt = createRepoUpdateSessionPrompt("playwright", ".cowboy/.tmp/playwright");

    expect(prompt).toContain('Update the skill "playwright"');
    expect(prompt).not.toContain("commit(s) since");
  });

  it("builds a topic prompt that requires official-source research", () => {
    const prompt = createTopicGenerationSessionPrompt("langchain");

    expect(prompt).toContain('topic: "langchain"');
    expect(prompt).toContain("Identify the canonical project");
    expect(prompt).toContain("Prefer official documentation");
    expect(prompt).toContain("Use the installed skill-creator skill as guide.");
  });

  it("topic prompt instructs the agent to write sources.yaml", () => {
    const prompt = createTopicGenerationSessionPrompt("data analyst");

    expect(prompt).toContain("sources.yaml");
    expect(prompt).toContain("GitHub repository URLs");
  });

  it("builds a multi-repo prompt listing all repos", () => {
    const prompt = createMultiRepoGenerationSessionPrompt(
      [
        { repoUrl: "https://github.com/scikit-learn/scikit-learn", relPath: ".cowboy/.tmp/scikit-learn" },
        { repoUrl: "https://github.com/matplotlib/matplotlib", relPath: ".cowboy/.tmp/matplotlib" },
      ],
      "data-analyst",
    );

    expect(prompt).toContain("scikit-learn");
    expect(prompt).toContain("matplotlib");
    expect(prompt).toContain(".cowboy/.tmp/scikit-learn");
    expect(prompt).toContain(".cowboy/.tmp/matplotlib");
    expect(prompt).toContain("data-analyst");
    expect(prompt).toContain("unified skill");
  });

  it("multi-repo prompt delegates to single-repo prompt when only one repo", () => {
    const prompt = createMultiRepoGenerationSessionPrompt(
      [{ repoUrl: "https://github.com/test/lib", relPath: ".cowboy/.tmp/lib" }],
      "test-skill",
    );

    expect(prompt).toContain(".cowboy/.tmp/lib");
    expect(prompt).not.toContain("unified skill");
  });

  it("builds a multi-source update prompt with per-repo sections", () => {
    const prompt = createMultiSourceUpdateSessionPrompt("data-analyst", [
      {
        repoUrl: "https://github.com/scikit-learn/scikit-learn",
        relPath: ".cowboy/.tmp/scikit-learn",
        diffSummary: "3 commit(s) since abc1234:\n  abc1234 Fix docs",
      },
      {
        repoUrl: "https://github.com/matplotlib/matplotlib",
        relPath: ".cowboy/.tmp/matplotlib",
      },
    ]);

    expect(prompt).toContain('Update the skill "data-analyst"');
    expect(prompt).toContain("## scikit-learn");
    expect(prompt).toContain("3 commit(s) since abc1234");
    expect(prompt).toContain("## matplotlib");
  });

  it("multi-source update prompt delegates to single-repo when only one source", () => {
    const prompt = createMultiSourceUpdateSessionPrompt("test-skill", [
      {
        repoUrl: "https://github.com/test/lib",
        relPath: ".cowboy/.tmp/lib",
        diffSummary: "1 commit(s) since aaa1111",
      },
    ]);

    expect(prompt).toContain('Update the skill "test-skill"');
    expect(prompt).toContain("1 commit(s) since aaa1111");
    expect(prompt).not.toContain("multiple source repositories");
  });
});

describe("parseSourcesYaml", () => {
  it("parses valid sources.yaml with repos list", async () => {
    const skillDir = join(tempDir, ".cowboy", "skills", "data-analyst");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "sources.yaml"),
      "repos:\n  - https://github.com/scikit-learn/scikit-learn\n  - https://github.com/matplotlib/matplotlib\n",
      "utf-8",
    );

    const repos = await parseSourcesYaml(tempDir, "data-analyst");
    expect(repos).toEqual([
      "https://github.com/scikit-learn/scikit-learn",
      "https://github.com/matplotlib/matplotlib",
    ]);
  });

  it("returns empty array when sources.yaml is missing", async () => {
    const repos = await parseSourcesYaml(tempDir, "nonexistent");
    expect(repos).toEqual([]);
  });

  it("returns empty array when sources.yaml is malformed", async () => {
    const skillDir = join(tempDir, ".cowboy", "skills", "bad-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "sources.yaml"),
      "this is not valid yaml: [",
      "utf-8",
    );

    const repos = await parseSourcesYaml(tempDir, "bad-skill");
    expect(repos).toEqual([]);
  });

  it("filters out non-https URLs", async () => {
    const skillDir = join(tempDir, ".cowboy", "skills", "mixed-urls");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "sources.yaml"),
      "repos:\n  - https://github.com/valid/repo\n  - http://insecure.com/repo\n  - not-a-url\n",
      "utf-8",
    );

    const repos = await parseSourcesYaml(tempDir, "mixed-urls");
    expect(repos).toEqual(["https://github.com/valid/repo"]);
  });
});

async function writeSkill(
  dir: string,
  name: string,
  description: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
