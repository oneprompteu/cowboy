# Architecture

## Source of truth

For generated skills, `.cowboy/skills/<name>/` is the canonical source of truth.

This avoids generating text to stdout and reparsing it later. The agent writes real files directly where Cowboy expects them.

## Installed locations

Cowboy adapts the canonical skill for the configured agent:

- Claude Code:
  - `.claude/skills/<name>/SKILL.md`
- Codex:
  - `.agents/skills/<name>/SKILL.md`

Cowboy intentionally skips optional Codex metadata files such as `agents/openai.yaml`.

## Registry

Installed skills are tracked in `.cowboy/installed.yaml`.

Generated skills store:

- `library_repo` when they come from `--repo`
- `research_query` when they come from a free-text topic
- `installed_at`
- `last_updated`
- `installed_for`

## Built-in skills

Cowboy includes a built-in `skill-creator` skill under `src/skills/skill-creator/`.

Cowboy ensures it is available before generation so the agent has a concrete rubric for building:

- `SKILL.md`
- `scripts/`
- `references/`
- `assets/`

## Removal

When a generated skill is removed, Cowboy deletes:

1. the installed agent-specific copies
2. the canonical source in `.cowboy/skills/<name>/`
