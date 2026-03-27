# Architecture

## Source of truth

Cowboy keeps a canonical project-local copy of each installed skill under `.cowboy/skills/<name>/`.

For generated skills, that directory is the long-lived source of truth.
Cowboy avoids generating text to stdout and reparsing it later. The agent writes real files directly where Cowboy expects them.

Imported skills are also copied there so Cowboy can support `enable` and `disable` without re-fetching the source repository.

## Installed locations

Cowboy adapts the canonical skill for the configured install targets:

- Claude Code:
  - `.claude/skills/<name>/SKILL.md`
- Codex:
  - `.agents/skills/<name>/SKILL.md`

The canonical package may also include agent-specific companion files when needed. For example, Cowboy preserves optional Codex metadata such as `agents/openai.yaml` in `.cowboy/skills/<name>/`, copies it to `.agents/skills/<name>/`, and omits it from `.claude/skills/<name>/`.
Cowboy only manages project-local agent directories. User-level Codex skill directories such as `~/.codex/skills` remain outside Cowboy's install surface.

## Registry

Installed skills are tracked in `.cowboy/installed.yaml`.

Imported skills store:

- `source_repo`
- `source_path`
- `content_hash`
- `installed_at`
- `installed_for`
- `disabled_for`

Generated skills store:

- `sources` when the agent or install flow has concrete GitHub repositories
- `doc_urls` when the skill was generated or updated from documentation URLs or local docs directories
- `research_query` when they come from a free-text topic
- `installed_at`
- `last_updated`
- `installed_for`
- `disabled_for`

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
