import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { cloneMock, revparseMock, sessionMock } = vi.hoisted(() => ({
  cloneMock: vi.fn(),
  revparseMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock("simple-git", () => ({
  default: vi.fn((dir?: string) => (
    dir
      ? { revparse: revparseMock }
      : { clone: cloneMock }
  )),
}));

vi.mock("../src/core/ai-bridge.js", () => ({
  runHeadlessAgentSession: sessionMock,
}));

import { generateSkill } from "../src/core/generator.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "cowboy-test-generator-isolation-"));
  process.env.COWBOY_DATA_DIR = join(tempDir, ".cowboy-global");
  cloneMock.mockReset();
  revparseMock.mockReset();
  sessionMock.mockReset();
  cloneMock.mockResolvedValue(undefined);
  revparseMock.mockResolvedValue("abc123def456\n");
});

afterEach(async () => {
  delete process.env.COWBOY_DATA_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

describe("generateSkill isolation", () => {
  it("uses an isolated workspace and hides unrelated installed skills", async () => {
    await writeSkill(
      join(tempDir, ".agents", "skills", "skill-creator"),
      "skill-creator",
      "Create skills",
    );
    await writeSkill(
      join(tempDir, ".agents", "skills", "mcp-dev"),
      "mcp-dev",
      "Existing unrelated skill",
    );
    await writeSkill(
      join(tempDir, ".cowboy", "skills", "existing-skill"),
      "existing-skill",
      "Existing canonical skill",
    );
    await writeFile(
      join(tempDir, ".cowboy", "config.yaml"),
      "agents:\n  - codex\ndefault_agent: codex\n",
      "utf-8",
    );

    sessionMock.mockImplementation(async ({ cwd, prompt }: {
      cwd: string;
      prompt: string;
    }) => {
      expect(cwd).not.toBe(tempDir);
      expect(cwd).toContain(`${join(".cowboy", ".tmp", "generate-")}`);
      expect(prompt).toContain("self-contained skill package");
      expect(prompt).toContain("Do not model it on other skills in the workspace");

      expect(await readFile(join(cwd, "config.yaml"), "utf-8")).toContain(
        "default_agent: codex",
      );
      expect(await exists(join(cwd, ".agents", "skills", "skill-creator", "SKILL.md"))).toBe(true);
      expect(await exists(join(cwd, ".agents", "skills", "mcp-dev", "SKILL.md"))).toBe(false);
      expect(await exists(join(cwd, "skills", "existing-skill", "SKILL.md"))).toBe(false);

      const skillDir = join(cwd, "skills", "deepagents");
      await mkdir(join(skillDir, "references"), { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        '---\nname: deepagents\ndescription: "Isolated deepagents skill"\n---\n\n# DeepAgents\n',
        "utf-8",
      );
      await writeFile(
        join(skillDir, "references", "source-map.md"),
        "# Source Map\n\nUseful reference.\n",
        "utf-8",
      );
    });

    const result = await generateSkill({
      projectDir: tempDir,
      aiAgent: "codex",
      source: {
        type: "repo",
        libraryRepos: ["https://github.com/langchain-ai/deepagents"],
      },
    });

    expect(result.skill.name).toBe("deepagents");
    expect(result.sources).toEqual([
      {
        repo: "https://github.com/langchain-ai/deepagents",
        commit_hash: "abc123def456",
      },
    ]);
    expect(cloneMock).toHaveBeenCalledOnce();

    const [, cloneDir] = cloneMock.mock.calls[0];
    expect(cloneDir).toContain(`${join(".cowboy", ".tmp", "generate-")}`);
    expect(result.skill.description).toBe("Isolated deepagents skill");
    const referenceFile = result.skill.files?.find((file) => file.relativePath === "references/source-map.md");
    expect(referenceFile?.content.toString("utf-8")).toContain("Useful reference.");

    const tempEntries = await readdir(join(tempDir, ".cowboy", ".tmp"));
    expect(tempEntries).toEqual([]);
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
