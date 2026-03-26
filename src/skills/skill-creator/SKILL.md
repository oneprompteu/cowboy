---
name: skill-creator
description: "Guide for creating effective AI agent skills. Use when the user wants to create, update, or improve a skill that extends an AI agent's capabilities with specialized knowledge, workflows, or tool integrations."
---

# Skill Creator

Guide for creating effective skills that work across AI coding agents such as Claude Code and Codex.

## What A Skill Is

A skill is a self-contained package that gives an agent reusable procedural knowledge, domain context, and optional resources that improve execution on a narrow class of tasks.

A skill can be as small as a single `SKILL.md` file or as broad as a package with references, examples, scripts, and assets. Choose the smallest package that still lets the agent perform the work well.

## Skill Package Model

Think in layers:

1. `SKILL.md` is the operational router.
2. `references/` stores long-form knowledge that would otherwise bloat `SKILL.md`.
3. `scripts/` stores deterministic, reusable operations.
4. `assets/` stores files used in outputs.

Do not try to force all knowledge into `SKILL.md`. The skill should be self-contained as a package, not as a single file.
When one agent benefits from extra metadata or helper files, keep the core skill portable and add the agent-specific files only if they materially improve that runtime.

## Structure Is Flexible

Use whatever structure the task needs. Do not force a fixed taxonomy of files.

Examples:

- A simple workflow skill may only need `SKILL.md`.
- A library skill may need `SKILL.md` plus several files under `references/`.
- A document-processing skill may need `SKILL.md`, deep references, and executable scripts.

Create only the files that materially improve the skill.

## What `SKILL.md` Should Do

Keep `SKILL.md` focused on orientation and execution:

- state when the skill should be used
- define the main task categories or decision points
- tell the agent what file or resource to open first for each kind of task
- capture the highest-signal pitfalls, invariants, and usage rules
- reference all bundled `references/`, `scripts/`, and `assets/` explicitly

Do not turn `SKILL.md` into a full documentation dump unless the domain is simple enough that one file is genuinely sufficient.

## When To Create A Broad Package

For library, framework, SDK, or protocol skills, default toward broad package coverage when the domain is large enough that a thin `SKILL.md` would leave the agent under-informed.

The goal is not to mirror documentation verbatim. The goal is to preserve most of the useful knowledge while compressing it intelligently for agent execution.

For broad library skills, include enough information for the agent to:

- understand the core concepts and mental model
- find the right APIs, files, or modules quickly
- follow the common setup and configuration paths
- copy proven usage patterns and examples
- avoid the important failure modes and gotchas
- know where to verify version-sensitive details

Reduce repetition, tutorial filler, marketing prose, and human-oriented exposition that does not improve agent performance.

## Research Standard

Base the skill on primary sources whenever possible.

Prioritize sources in this order:

1. Official documentation
2. Maintainer-owned repositories and examples
3. Official package registries or SDK references
4. Primary specifications or standards
5. High-quality third-party material only when the primary sources leave gaps

When starting from a free-text topic, first identify the canonical project, package, framework, or specification before writing the skill.

If external research materially informs the skill, include a concise bibliography in `references/sources.md`.

## Designing The Package

Start from concrete user tasks and trigger phrases.

Ask:

- What tasks should this skill support?
- What would a user say that should trigger it?
- What does the agent need here that a general model would not reliably know?
- What knowledge is short and operational enough for `SKILL.md`?
- What knowledge belongs in companion files because it is long, detailed, or only needed in specific branches?

Then design the package around those needs.

## `references/`

Use `references/` for long-form knowledge that improves quality but should not live in the main skill body.

Good candidates:

- source maps
- architecture maps
- API or module summaries
- patterns and example walkthroughs
- configuration guides
- gotchas and failure modes
- official-source bibliographies
- condensed documentation extracted from official docs

Keep these files dense and navigable. Prefer compressed, high-signal summaries over verbatim copies. Include headings, search-friendly terms, and file or symbol names when that helps the agent jump quickly to the right place.

## `scripts/`

Use scripts only when they add real deterministic value.

Good candidates:

- file conversion
- validation
- extraction
- repetitive transformations
- setup or inspection helpers the agent would otherwise rewrite repeatedly

Do not create placeholder scripts, sample scripts, or decorative scripts. If the agent can write the code directly as part of the task and there is no reuse or determinism benefit, omit `scripts/`.

## `assets/`

Use `assets/` for files that are meant to be copied, filled, or transformed in the final output.

Examples:

- templates
- starter projects
- images
- icons
- fonts
- sample documents

## Writing Process

### Step 1: Understand Use Cases

Identify concrete tasks, trigger phrases, and success criteria.

### Step 2: Research Canonical Sources

Read the official docs, maintainer examples, relevant source files, and other primary material.

### Step 3: Decide Package Depth

Choose between:

- a single-file skill when the domain is small
- a broad package when the domain needs substantial supporting knowledge

### Step 4: Allocate Knowledge

Put short operational guidance in `SKILL.md`.
Put long or branch-specific knowledge in `references/`.
Add `scripts/` only where they provide deterministic leverage.

### Step 5: Write The Skill

Write in imperative or infinitive form. Focus on non-obvious procedural knowledge and decision support.

### Step 6: Trim And Densify

Remove repetition, low-value prose, placeholders, and empty folders. Keep the useful knowledge; compress the rest.

### Step 7: Test And Iterate

Use the skill on a realistic task, observe where the agent still struggles, and update the package accordingly.

## Quality Checks

Before considering the skill done, verify that:

- the directory name matches the frontmatter `name`
- the description is specific enough to trigger in the right situations
- `SKILL.md` routes the agent effectively
- the package contains the right supporting knowledge for the domain
- companion files are useful and non-redundant
- scripts are deterministic and reusable, not placeholders
- the overall package is broad enough to help but dense enough to stay efficient

## Context Strategy

Use progressive disclosure:

1. metadata is always visible
2. `SKILL.md` loads when the skill triggers
3. companion files should be opened only when needed

Design the package so the agent can solve common tasks from `SKILL.md` plus a small number of targeted companion reads, not by re-reading the whole package every time.
