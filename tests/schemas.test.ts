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

  it("defaults disabled_for to empty array", () => {
    const result = ImportedSkillSchema.safeParse({
      name: "tdd-workflow",
      type: "imported",
      source_repo: "https://github.com/test/repo",
      source_path: "skills/tdd-workflow/SKILL.md",
      content_hash: "sha256:abc123",
      installed_at: "2026-03-17",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disabled_for).toEqual([]);
    }
  });

  it("accepts skill with disabled_for agents", () => {
    const result = ImportedSkillSchema.safeParse({
      name: "tdd-workflow",
      type: "imported",
      source_repo: "https://github.com/test/repo",
      source_path: "skills/tdd-workflow/SKILL.md",
      content_hash: "sha256:abc123",
      installed_at: "2026-03-17",
      installed_for: ["claude", "codex"],
      disabled_for: ["codex"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disabled_for).toEqual(["codex"]);
    }
  });

  it("accepts generated skill with sources", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      sources: [{ repo: "https://github.com/langchain-ai/langchain" }],
      installed_at: "2026-03-17",
      last_updated: "2026-03-17",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts generated skill with sources and commit_hash", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      sources: [{ repo: "https://github.com/langchain-ai/langchain", commit_hash: "abc1234def5678" }],
      installed_at: "2026-03-17",
      last_updated: "2026-03-17",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources![0].commit_hash).toBe("abc1234def5678");
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
          sources: [{ repo: "https://github.com/langchain-ai/langchain" }],
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

  it("rejects skill with no sources, doc_urls, or research_query", () => {
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

describe("GeneratedSkillSchema with doc_urls", () => {
  it("accepts skill with doc_urls only", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      doc_urls: ["https://docs.langchain.com"],
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.doc_urls).toEqual(["https://docs.langchain.com"]);
    }
  });

  it("accepts skill with sources and doc_urls", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "data-analyst",
      type: "generated",
      sources: [{ repo: "https://github.com/scikit-learn/scikit-learn" }],
      doc_urls: ["https://scikit-learn.org/stable/"],
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts skill with research_query and doc_urls", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "langchain-guide",
      type: "generated",
      research_query: "langchain",
      doc_urls: ["https://docs.langchain.com"],
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects skill with empty doc_urls and no other source", () => {
    const result = GeneratedSkillSchema.safeParse({
      name: "orphan",
      type: "generated",
      doc_urls: [],
      installed_at: "2026-03-18",
      last_updated: "2026-03-18",
      installed_for: ["claude"],
    });
    expect(result.success).toBe(false);
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
