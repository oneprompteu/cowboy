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

export const ClaudeEffortSchema = z.union([
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
  z.literal("max"),
]);
export type ClaudeEffort = z.infer<typeof ClaudeEffortSchema>;

export const CodexReasoningEffortSchema = z.union([
  z.literal("none"),
  z.literal("minimal"),
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
  z.literal("xhigh"),
]);
export type CodexReasoningEffort = z.infer<typeof CodexReasoningEffortSchema>;

export const ClaudeGenerationDefaultsSchema = z.object({
  model: z.string().min(1).optional(),
  effort: ClaudeEffortSchema.optional(),
});
export type ClaudeGenerationDefaults = z.infer<typeof ClaudeGenerationDefaultsSchema>;

export const CodexGenerationDefaultsSchema = z.object({
  effort: CodexReasoningEffortSchema.optional(),
});
export type CodexGenerationDefaults = z.infer<typeof CodexGenerationDefaultsSchema>;

// --- .cowboy/config.yaml ---

export const CowboyConfigSchema = z.object({
  agents: z.array(AgentType),
  default_agent: AgentType.optional(),
  generation_defaults: z.object({
    claude: ClaudeGenerationDefaultsSchema.optional(),
    codex: CodexGenerationDefaultsSchema.optional(),
  }).optional(),
});

export type CowboyConfig = z.infer<typeof CowboyConfigSchema>;

// --- .cowboy/installed.yaml ---

const ProjectInstalledSkillBase = z.object({
  name: z.string(),
  installed_for: z.array(AgentType),
  disabled_for: z.array(AgentType).default([]),
  added_at: z.string(),
});

export const ProjectInstalledSkillSchema = ProjectInstalledSkillBase;
export type ProjectInstalledSkill = z.infer<typeof ProjectInstalledSkillSchema>;

export const ProjectRegistrySchema = z.object({
  skills: z.array(ProjectInstalledSkillSchema).default([]),
});

export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;

const GlobalInstalledSkillBase = z.object({
  name: z.string(),
  installed_at: z.string(),
  linked_projects: z.array(z.string()).default([]),
});

export const GlobalImportedSkillSchema = GlobalInstalledSkillBase.extend({
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

export const GlobalGeneratedSkillSchema = GlobalInstalledSkillBase.extend({
  type: z.literal("generated"),
  research_query: z.string().min(1).optional(),
  sources: z.array(SkillSourceSchema).optional(),
  doc_urls: z.array(z.string().min(1)).optional(),
  last_updated: z.string(),
}).refine(
  (skill) => Boolean(
    (skill.sources && skill.sources.length > 0) ||
    (skill.doc_urls && skill.doc_urls.length > 0) ||
    skill.research_query
  ),
  {
    message: "Generated skills require sources, doc_urls, or research_query",
    path: ["sources"],
  },
);

export const GlobalInstalledSkillSchema = z.discriminatedUnion("type", [
  GlobalImportedSkillSchema,
  GlobalGeneratedSkillSchema,
]);

export type GlobalInstalledSkill = z.infer<typeof GlobalInstalledSkillSchema>;
export type GlobalImportedSkill = z.infer<typeof GlobalImportedSkillSchema>;
export type GlobalGeneratedSkill = z.infer<typeof GlobalGeneratedSkillSchema>;

export const GlobalRegistrySchema = z.object({
  skills: z.array(GlobalInstalledSkillSchema).default([]),
});

export type GlobalRegistry = z.infer<typeof GlobalRegistrySchema>;

// --- Merged project + global skill view ---

const InstalledSkillBase = z.object({
  name: z.string(),
  installed_at: z.string(),
  installed_for: z.array(AgentType),
  disabled_for: z.array(AgentType).default([]),
});

export const ImportedSkillSchema = InstalledSkillBase.extend({
  type: z.literal("imported"),
  source_repo: z.string(),
  source_path: z.string(),
  content_hash: z.string(),
});

export const GeneratedSkillSchema = InstalledSkillBase.extend({
  type: z.literal("generated"),
  research_query: z.string().min(1).optional(),
  sources: z.array(SkillSourceSchema).optional(),
  doc_urls: z.array(z.string().min(1)).optional(),
  last_updated: z.string(),
}).refine(
  (skill) => Boolean(
    (skill.sources && skill.sources.length > 0) ||
    (skill.doc_urls && skill.doc_urls.length > 0) ||
    skill.research_query
  ),
  {
    message: "Generated skills require sources, doc_urls, or research_query",
    path: ["sources"],
  },
);

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
