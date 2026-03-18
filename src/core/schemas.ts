import { z } from "zod/v4";

// --- SKILL.md frontmatter ---

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  origin: z.string().optional(),
  tools: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// --- Skill files (companion files beyond SKILL.md) ---

/** A file that belongs to a skill directory (scripts, references, assets, etc.) */
export interface SkillFile {
  /** Path relative to the skill directory root (e.g. "scripts/extract.py") */
  relativePath: string;
  /** File content as Buffer (supports both text and binary files) */
  content: Buffer;
}

// --- Parsed skill (frontmatter + content + location) ---

export const ScannedSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Raw markdown content (full SKILL.md including frontmatter) */
  rawContent: z.string(),
  /** Markdown body (without frontmatter) */
  body: z.string(),
  /** Path relative to the repo root where this SKILL.md was found */
  relativePath: z.string(),
  /** Original frontmatter fields */
  frontmatter: SkillFrontmatterSchema,
});

/** A scanned skill with optional companion files from its directory */
export interface ScannedSkill extends z.infer<typeof ScannedSkillSchema> {
  /** Additional files in the skill directory (scripts, references, etc.) */
  files?: SkillFile[];
}

// --- Agent types ---

export const AgentType = z
  .union([z.literal("claude"), z.literal("claude-code"), z.literal("codex")])
  .transform((value) => value === "claude-code" ? "claude" : value);
export type AgentType = z.infer<typeof AgentType>;

// --- .cowboy/config.yaml ---

export const CowboyConfigSchema = z.object({
  agents: z.array(AgentType),
  default_agent: AgentType.optional(),
}).refine(
  (config) => !config.default_agent || config.agents.includes(config.default_agent),
  {
    message: "default_agent must be one of the configured agents",
    path: ["default_agent"],
  },
);

export type CowboyConfig = z.infer<typeof CowboyConfigSchema>;

// --- .cowboy/installed.yaml ---

const InstalledSkillBase = z.object({
  name: z.string(),
  installed_at: z.string(),
  installed_for: z.array(AgentType),
});

export const ImportedSkillSchema = InstalledSkillBase.extend({
  type: z.literal("imported"),
  source_repo: z.string(),
  source_path: z.string(),
  content_hash: z.string(),
});

export const SkillSourceSchema = z.object({
  repo: z.string().url(),
  commit_hash: z.string().optional(),
});

export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const GeneratedSkillSchema = InstalledSkillBase.extend({
  type: z.literal("generated"),
  /** @deprecated Use sources instead. Kept for reading old installed.yaml files. */
  library_repo: z.string().url().optional(),
  /** @deprecated Use sources instead. Kept for reading old installed.yaml files. */
  commit_hash: z.string().optional(),
  research_query: z.string().min(1).optional(),
  sources: z.array(SkillSourceSchema).optional(),
  last_updated: z.string(),
}).refine(
  (skill) => Boolean(
    (skill.sources && skill.sources.length > 0) ||
    skill.library_repo ||
    skill.research_query
  ),
  {
    message: "Generated skills require sources, library_repo, or research_query",
    path: ["sources"],
  },
);

/**
 * Normalize legacy GeneratedSkill entries: migrate library_repo + commit_hash
 * into the sources array. Called by readRegistry() on load.
 */
export function normalizeGeneratedSkill(skill: GeneratedSkill): GeneratedSkill {
  if (skill.sources?.length) return skill;
  if (skill.library_repo) {
    return {
      ...skill,
      sources: [{ repo: skill.library_repo, commit_hash: skill.commit_hash }],
    };
  }
  return skill;
}

export const InstalledSkillSchema = z.discriminatedUnion("type", [
  ImportedSkillSchema,
  GeneratedSkillSchema,
]);

export type InstalledSkill = z.infer<typeof InstalledSkillSchema>;
export type ImportedSkill = z.infer<typeof ImportedSkillSchema>;
export type GeneratedSkill = z.infer<typeof GeneratedSkillSchema>;

export const InstalledRegistrySchema = z.object({
  skills: z.array(InstalledSkillSchema).default([]),
});

export type InstalledRegistry = z.infer<typeof InstalledRegistrySchema>;

// --- Codex openai.yaml ---

export const CodexOpenAIYamlSchema = z.object({
  interface: z.object({
    display_name: z.string(),
    short_description: z.string(),
    brand_color: z.string().default("#000000"),
    default_prompt: z.string(),
  }),
  policy: z.object({
    allow_implicit_invocation: z.boolean().default(true),
  }),
});

export type CodexOpenAIYaml = z.infer<typeof CodexOpenAIYamlSchema>;
