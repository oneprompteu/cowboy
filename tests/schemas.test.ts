import { describe, it, expect } from "vitest";
import {
  SkillFrontmatterSchema,
  ScannedSkillSchema,
  CowboyConfigSchema,
  InstalledRegistrySchema,
  ImportedSkillSchema,
  GeneratedSkillSchema,
  SkillSourceSchema,
  CodexOpenAIYamlSchema,
  normalizeGeneratedSkill,
} from "../src/core/schemas.js";

describe("SkillFrontmatterSchema", () => {
  it("accepts valid frontmatter with required fields", () => {
    const result = SkillFrontmatterSchema.safeParse({
      name: "tdd-workflow",
      description: "TDD workflow for any project",
    });
    expect(result.success).toBe(true);
  });

  it("accepts frontmatter with optional fields", () => {
    const result = SkillFrontmatterSchema.safeParse({
      name: "tdd-workflow",
      description: "TDD workflow",
      origin: "ECC",
      tools: "Bash,Edit",
    });
    expect(result.success).toBe(true);
  });

  it("rejects frontmatter without name", () => {
    const result = SkillFrontmatterSchema.safeParse({
      description: "Some description",
    });
    expect(result.success).toBe(false);
  });

  it("rejects frontmatter without description", () => {
    const result = SkillFrontmatterSchema.safeParse({
      name: "my-skill",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = SkillFrontmatterSchema.safeParse({
      name: "",
      description: "Some description",
    });
    expect(result.success).toBe(false);
  });
});

describe("ScannedSkillSchema", () => {
  it("accepts a fully populated scanned skill", () => {
    const result = ScannedSkillSchema.safeParse({
      name: "tdd-workflow",
      description: "TDD workflow",
      rawContent: "---\nname: tdd-workflow\n---\n# TDD",
      body: "# TDD",
      relativePath: "skills/tdd-workflow/SKILL.md",
      frontmatter: {
        name: "tdd-workflow",
        description: "TDD workflow",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("CowboyConfigSchema", () => {
  it("accepts valid agent list", () => {
    const result = CowboyConfigSchema.safeParse({
      agents: ["claude", "codex"],
      default_agent: "codex",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown agent type", () => {
    const result = CowboyConfigSchema.safeParse({
      agents: ["claude", "unknown-agent"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts single agent", () => {
    const result = CowboyConfigSchema.safeParse({
      agents: ["claude"],
      default_agent: "claude",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual(["claude"]);
    }
  });

  it("rejects default_agent that is not configured", () => {
    const result = CowboyConfigSchema.safeParse({
      agents: ["claude"],
      default_agent: "codex",
    });
    expect(result.success).toBe(false);
  });

  it("normalizes legacy claude-code values", () => {
    const result = CowboyConfigSchema.safeParse({
      agents: ["claude-code", "codex"],
      default_agent: "claude-code",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual(["claude", "codex"]);
      expect(result.data.default_agent).toBe("claude");
    }
  });
});

describe("InstalledRegistrySchema", () => {
  it("accepts empty registry", () => {
    const result = InstalledRegistrySchema.safeParse({ skills: [] });
    expect(result.success).toBe(true);
  });

  it("defaults skills to empty array", () => {
    const result = InstalledRegistrySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual([]);
    }
  });

  it("accepts imported skill", () => {
    const result = ImportedSkillSchema.safeParse({
      name: "tdd-workflow",
      type: "imported",
      source_repo: "https://github.com/affaan-m/everything-claude-code",
      source_path: "skills/tdd-workflow/SKILL.md",
      content_hash: "sha256:abc123",
      installed_at: "2026-03-17",
      installed_for: ["claude", "codex"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts generated skill", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      library_repo: "https://github.com/langchain-ai/langchain",
      installed_at: "2026-03-17",
      last_updated: "2026-03-17",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts generated skill with commit_hash", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      library_repo: "https://github.com/langchain-ai/langchain",
      installed_at: "2026-03-17",
      last_updated: "2026-03-17",
      commit_hash: "abc1234def5678",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commit_hash).toBe("abc1234def5678");
    }
  });

  it("accepts generated skill without commit_hash (backward compat)", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      library_repo: "https://github.com/langchain-ai/langchain",
      installed_at: "2026-03-17",
      last_updated: "2026-03-17",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commit_hash).toBeUndefined();
    }
  });

  it("accepts generated skill created from a research query", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      research_query: "langchain",
      installed_at: "2026-03-17",
      last_updated: "2026-03-17",
      installed_for: ["codex"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts registry with mixed skill types", () => {
    const result = InstalledRegistrySchema.safeParse({
      skills: [
        {
          name: "tdd-workflow",
          type: "imported",
          source_repo: "https://github.com/affaan-m/everything-claude-code",
          source_path: "skills/tdd-workflow/SKILL.md",
          content_hash: "sha256:abc123",
          installed_at: "2026-03-17",
          installed_for: ["claude", "codex"],
        },
        {
          name: "langchain-guide",
          type: "generated",
          library_repo: "https://github.com/langchain-ai/langchain",
          installed_at: "2026-03-17",
          last_updated: "2026-03-17",
          installed_for: ["claude"],
        },
        {
          name: "langgraph-guide",
          type: "generated",
          research_query: "langgraph",
          installed_at: "2026-03-17",
          last_updated: "2026-03-17",
          installed_for: ["codex"],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toHaveLength(3);
    }
  });
});

describe("SkillSourceSchema", () => {
  it("accepts valid source with commit_hash", () => {
    const result = SkillSourceSchema.safeParse({
      repo: "https://github.com/scikit-learn/scikit-learn",
      commit_hash: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts source without commit_hash", () => {
    const result = SkillSourceSchema.safeParse({
      repo: "https://github.com/scikit-learn/scikit-learn",
    });
    expect(result.success).toBe(true);
  });

  it("rejects source with invalid URL", () => {
    const result = SkillSourceSchema.safeParse({
      repo: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("GeneratedSkillSchema with sources", () => {
  it("accepts skill with sources array", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "data-analyst",
      type: "generated",
      sources: [
        { repo: "https://github.com/scikit-learn/scikit-learn", commit_hash: "abc123" },
        { repo: "https://github.com/matplotlib/matplotlib", commit_hash: "def456" },
      ],
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources).toHaveLength(2);
    }
  });

  it("accepts skill with sources and research_query", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "data-analyst",
      type: "generated",
      sources: [
        { repo: "https://github.com/scikit-learn/scikit-learn", commit_hash: "abc123" },
      ],
      research_query: "data analyst",
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects skill with no sources, library_repo, or research_query", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "orphan",
      type: "generated",
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects skill with empty sources and no research_query", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "orphan",
      type: "generated",
      sources: [],
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(false);
  });
});

describe("normalizeGeneratedSkill", () => {
  it("migrates legacy library_repo + commit_hash to sources", () => {
    const skill = {
      name: "test",
      type: "generated" as const,
      library_repo: "https://github.com/test/lib",
      commit_hash: "abc123",
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude" as const],
    };

    const normalized = normalizeGeneratedSkill(skill);
    expect(normalized.sources).toEqual([
      { repo: "https://github.com/test/lib", commit_hash: "abc123" },
    ]);
  });

  it("migrates legacy library_repo without commit_hash", () => {
    const skill = {
      name: "test",
      type: "generated" as const,
      library_repo: "https://github.com/test/lib",
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude" as const],
    };

    const normalized = normalizeGeneratedSkill(skill);
    expect(normalized.sources).toEqual([
      { repo: "https://github.com/test/lib", commit_hash: undefined },
    ]);
  });

  it("keeps existing sources untouched", () => {
    const sources = [
      { repo: "https://github.com/a/b", commit_hash: "111" },
      { repo: "https://github.com/c/d", commit_hash: "222" },
    ];
    const skill = {
      name: "test",
      type: "generated" as const,
      sources,
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude" as const],
    };

    const normalized = normalizeGeneratedSkill(skill);
    expect(normalized.sources).toBe(sources);
  });

  it("returns topic-only skills unchanged", () => {
    const skill = {
      name: "test",
      type: "generated" as const,
      research_query: "langchain",
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude" as const],
    };

    const normalized = normalizeGeneratedSkill(skill);
    expect(normalized.sources).toBeUndefined();
    expect(normalized.research_query).toBe("langchain");
  });
});

describe("CodexOpenAIYamlSchema", () => {
  it("accepts valid openai.yaml data", () => {
    const result = CodexOpenAIYamlSchema.safeParse({
      interface: {
        display_name: "TDD Workflow",
        short_description: "Red-Green-Refactor TDD workflow",
        brand_color: "#FF0000",
        default_prompt: "Use TDD workflow to write tests first",
      },
      policy: {
        allow_implicit_invocation: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for brand_color and allow_implicit_invocation", () => {
    const result = CodexOpenAIYamlSchema.safeParse({
      interface: {
        display_name: "My Skill",
        short_description: "A skill",
        default_prompt: "Use this skill",
      },
      policy: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interface.brand_color).toBe("#000000");
      expect(result.data.policy.allow_implicit_invocation).toBe(true);
    }
  });
});
