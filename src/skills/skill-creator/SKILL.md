---
name: skill-creator
description: "Guide for creating effective AI agent skills. Use when the user wants to create, update, or improve a skill that extends an AI agent's capabilities with specialized knowledge, workflows, or tool integrations."
---

# Skill Creator

Guide for creating effective skills that work across AI coding agents (Claude Code, Codex, etc.).

## What is a Skill

A skill is a self-contained package that extends an AI agent's capabilities with specialized knowledge, workflows, and tools. Skills transform a general-purpose agent into a specialist equipped with procedural knowledge that no model can fully possess.

Skills provide:

1. **Specialized workflows** — Multi-step procedures for specific domains
2. **Tool integrations** — Instructions for working with specific file formats or APIs
3. **Domain expertise** — Company-specific knowledge, schemas, business logic
4. **Bundled resources** — Scripts, references, and assets for complex and repetitive tasks

## Skill Structure

Every skill has a required `SKILL.md` file and optional bundled resources:

```
skill-name/
├── SKILL.md              (required — metadata + instructions)
├── scripts/              (optional — executable code)
│   ├── extract.py
│   └── validate.sh
├── references/           (optional — documentation loaded into context as needed)
│   ├── api-docs.md
│   └── schema.md
└── assets/               (optional — files used in output, not loaded into context)
    ├── template.html
    └── logo.png
```

### SKILL.md (required)

The main file. Has two parts:

**1. YAML frontmatter** — `name` and `description` are required. The description determines when the agent activates the skill, so be specific about what it does and when to use it.

```yaml
---
name: my-skill
description: "Clear description of what this skill does and when to use it"
---
```

**2. Markdown body** — Practical guidance for the AI agent. Write in imperative/infinitive form (verb-first instructions). Focus on non-obvious information that the agent would not know from its training.

### Scripts (`scripts/`)

Executable code (Python, Bash, Node, etc.) for tasks that require deterministic reliability or are rewritten repeatedly.

- Include when the same code would be rewritten on every invocation
- Example: `scripts/rotate_pdf.py` for PDF rotation, `scripts/validate.sh` for linting
- Benefits: token-efficient, deterministic, can be executed without loading into context
- Scripts may still need to be read by the agent for patching or environment adjustments

### References (`references/`)

Documentation loaded into context as needed to inform the agent's process.

- Include for documentation the agent should reference while working
- Examples: database schemas, API docs, domain knowledge, company policies
- Benefits: keeps SKILL.md lean, loaded only when the agent determines it's needed
- For large files (>10k words), include grep search patterns in SKILL.md so the agent can find relevant sections
- Avoid duplication: information should live in either SKILL.md or references, not both

### Assets (`assets/`)

Files used in output, not loaded into context.

- Include when the skill needs files for the final output
- Examples: templates, images, icons, fonts, boilerplate code
- Benefits: separates output resources from documentation

## Creating a Skill

### Step 1: Define Concrete Use Cases

Understand exactly how the skill will be used. Ask:

- What tasks should this skill support?
- What would a user say that should trigger this skill?
- What does the agent need to know that it doesn't already?

When the starting point is a free-text topic rather than a specific repository, first identify the canonical project, package, framework, or specification before writing the skill.

### Research Standard

Base the skill on primary sources whenever possible.

Prioritize sources in this order:

1. Official documentation sites
2. Maintainer-owned repositories and examples
3. Package registries or official SDK references
4. Primary specifications or standards
5. High-quality third-party tutorials only when official material leaves gaps

Avoid building the skill from random blog posts, forum threads, or SEO summaries when official documentation exists.

If external research materially informs the skill, include a concise bibliography in `references/sources.md` with the official links or source names the agent should trust first.

### Step 2: Plan Reusable Resources

For each use case, identify what scripts, references, and assets would help:

- Code that gets rewritten every time → `scripts/`
- Documentation the agent needs to reference → `references/`
- Files used in output → `assets/`

### Step 3: Create the Skill Directory

```
mkdir -p skill-name/{scripts,references,assets}
```

Create `SKILL.md` with frontmatter and instructions. Delete any empty subdirectories not needed.

### Step 4: Write SKILL.md

The body should answer:

1. What is the purpose of the skill?
2. When should it be used?
3. How should the agent use it? Reference all bundled resources so the agent knows they exist.

**Writing guidelines:**
- Use imperative/infinitive form ("To accomplish X, do Y"), not second person
- Focus on non-obvious procedural knowledge
- Include code examples where they clarify usage
- Keep SKILL.md lean — move detailed reference material to `references/`
- Prefer guidance that is stable across versions; if the skill depends on version-specific behavior, note where to verify it in the official sources

### Step 5: Test and Iterate

1. Use the skill on real tasks
2. Notice struggles or inefficiencies
3. Update SKILL.md or bundled resources
4. Test again

## Context Loading Strategy

Skills use progressive disclosure to manage context efficiently:

1. **Metadata** (name + description) — Always in context (~100 words)
2. **SKILL.md body** — When skill triggers (<5k words ideal)
3. **Bundled resources** — Loaded as needed by the agent (unlimited, since scripts can be executed without reading)
