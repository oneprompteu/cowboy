import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDocsGenerationSessionPrompt,
  createDocsUpdateSessionPrompt,
  createRepoGenerationSessionPrompt,
  createRepoUpdateSessionPrompt,
  createMultiRepoGenerationSessionPrompt,
  createMultiSourceUpdateSessionPrompt,
  createTopicGenerationSessionPrompt,
  ensureGeneratedSkillSource,
  parseSourcesYaml,
  resolveDocSources,
  resolveGeneratedSkill,
  scanGeneratedSkills,
} from "../src/core/generator.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-generator-"));
  process.env.COWBOY_DATA_DIR = join(tempDir, ".cowboy-global");
  await mkdir(join(tempDir, ".cowboy", "skills"), { recursive: true });
});

afterEach(async () => {
  delete process.env.COWBOY_DATA_DIR;
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
  it("bootstraps canonical source from an installed Codex skill and preserves openai.yaml", async () => {
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
    expect(await exists(openaiYamlPath)).toBe(true);
    expect(await readFile(openaiYamlPath, "utf-8")).toContain("display_name: dbt");

    const skills = await scanGeneratedSkills(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("dbt");
  });
});

describe("generation prompts", () => {
  it("builds a repo prompt that points the agent at skills/", () => {
    const prompt = createRepoGenerationSessionPrompt("repos/playwright", "playwright");

    expect(prompt).toContain("skills/playwright/");
    expect(prompt).toContain("repos/playwright");
    expect(prompt).toContain("skill-creator");
    expect(prompt).toContain("self-contained skill package");
    expect(prompt).toContain("Do not model it on other skills in the workspace");
    expect(prompt).toContain("Keep SKILL.md focused on orientation and task routing");
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
    expect(prompt).toContain("portable self-contained skill package");
    expect(prompt).toContain("Choose the package structure freely");
  });

  it("topic prompt instructs the agent to write sources.yaml", () => {
    const prompt = createTopicGenerationSessionPrompt("data analyst");

    expect(prompt).toContain("sources.yaml");
    expect(prompt).toContain("GitHub repository URLs");
  });

  it("builds a multi-repo prompt listing all repos", () => {
    const prompt = createMultiRepoGenerationSessionPrompt(
      [
        { repoUrl: "https://github.com/scikit-learn/scikit-learn", relPath: "repos/scikit-learn" },
        { repoUrl: "https://github.com/matplotlib/matplotlib", relPath: "repos/matplotlib" },
      ],
      "data-analyst",
    );

    expect(prompt).toContain("scikit-learn");
    expect(prompt).toContain("matplotlib");
    expect(prompt).toContain("repos/scikit-learn");
    expect(prompt).toContain("repos/matplotlib");
    expect(prompt).toContain("data-analyst");
    expect(prompt).toContain("unified self-contained skill package");
    expect(prompt).toContain("Do not model it on other skills in the workspace");
  });

  it("multi-repo prompt delegates to single-repo prompt when only one repo", () => {
    const prompt = createMultiRepoGenerationSessionPrompt(
      [{ repoUrl: "https://github.com/test/lib", relPath: "repos/lib" }],
      "test-skill",
    );

    expect(prompt).toContain("repos/lib");
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

describe("docs prompts", () => {
  it("repo prompt includes doc URLs when provided", () => {
    const prompt = createRepoGenerationSessionPrompt(
      "repos/langchain",
      "langchain",
      ["https://docs.langchain.com"],
    );

    expect(prompt).toContain("repos/langchain");
    expect(prompt).toContain("https://docs.langchain.com");
    expect(prompt).toContain("web browsing tools");
  });

  it("multi-repo prompt includes doc URLs when provided", () => {
    const prompt = createMultiRepoGenerationSessionPrompt(
      [
        { repoUrl: "https://github.com/scikit-learn/scikit-learn", relPath: "repos/scikit-learn" },
        { repoUrl: "https://github.com/matplotlib/matplotlib", relPath: "repos/matplotlib" },
      ],
      "data-analyst",
      ["https://scikit-learn.org/stable/"],
    );

    expect(prompt).toContain("scikit-learn");
    expect(prompt).toContain("https://scikit-learn.org/stable/");
    expect(prompt).toContain("web browsing tools");
  });

  it("topic prompt includes doc URLs when provided", () => {
    const prompt = createTopicGenerationSessionPrompt(
      "langchain",
      undefined,
      ["https://docs.langchain.com"],
    );

    expect(prompt).toContain("langchain");
    expect(prompt).toContain("https://docs.langchain.com");
    expect(prompt).toContain("web browsing tools");
  });

  it("builds a docs-only generation prompt", () => {
    const prompt = createDocsGenerationSessionPrompt(
      ["https://docs.langchain.com", "/tmp/langchain-docs"],
      "langchain",
    );

    expect(prompt).toContain("https://docs.langchain.com");
    expect(prompt).toContain("/tmp/langchain-docs");
    expect(prompt).toContain("web browsing tools");
    expect(prompt).toContain("Local documentation directories");
    expect(prompt).toContain("langchain");
    expect(prompt).toContain("sources.yaml");
  });

  it("builds a docs update prompt", () => {
    const prompt = createDocsUpdateSessionPrompt("langchain", [
      "https://docs.langchain.com",
    ]);

    expect(prompt).toContain('Update the skill "langchain"');
    expect(prompt).toContain("https://docs.langchain.com");
    expect(prompt).toContain("web browsing tools");
  });

  it("repo prompt includes local docs directories when provided", () => {
    const prompt = createRepoGenerationSessionPrompt(
      "repos/langchain",
      "langchain",
      ["/tmp/langchain-docs"],
    );

    expect(prompt).toContain("/tmp/langchain-docs");
    expect(prompt).toContain("Read their files directly");
  });

  it("repo update prompt includes doc URLs when provided", () => {
    const prompt = createRepoUpdateSessionPrompt(
      "langchain",
      ".cowboy/.tmp/langchain",
      "2 commit(s) since abc1234",
      ["https://docs.langchain.com"],
    );

    expect(prompt).toContain("2 commit(s) since abc1234");
    expect(prompt).toContain("https://docs.langchain.com");
  });

  it("multi-source update prompt includes doc URLs when provided", () => {
    const prompt = createMultiSourceUpdateSessionPrompt(
      "data-analyst",
      [
        { repoUrl: "https://github.com/scikit-learn/scikit-learn", relPath: ".cowboy/.tmp/scikit-learn" },
      ],
      ["https://scikit-learn.org/stable/"],
    );

    expect(prompt).toContain("https://scikit-learn.org/stable/");
    expect(prompt).toContain("web browsing tools");
  });

  it("prompts omit docs section when no doc URLs provided", () => {
    const prompt = createRepoGenerationSessionPrompt("repos/lib", "test");

    expect(prompt).not.toContain("web browsing tools");
    expect(prompt).not.toContain("documentation websites");
  });
});

describe("resolveDocSources", () => {
  it("preserves web URLs and resolves local directories to absolute paths", async () => {
    const localDocsDir = join(tempDir, "local-docs");
    await mkdir(localDocsDir, { recursive: true });

    const resolved = await resolveDocSources(
      ["https://docs.example.com", "./local-docs"],
      tempDir,
    );

    expect(resolved.entries).toEqual([
      "https://docs.example.com",
      localDocsDir,
    ]);
    expect(resolved.webUrls).toEqual(["https://docs.example.com"]);
    expect(resolved.localDirs).toEqual([localDocsDir]);
  });

  it("rejects local doc paths that are files", async () => {
    const localFile = join(tempDir, "notes.md");
    await writeFile(localFile, "# Notes\n", "utf-8");

    await expect(
      resolveDocSources(["./notes.md"], tempDir),
    ).rejects.toThrow('Local docs path "./notes.md" is not a directory.');
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
