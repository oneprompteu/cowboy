# Architecture

## Source of truth

Cowboy keeps the real canonical skill package in a global user-level data directory:

- macOS: `~/Library/Application Support/Cowboy`
- Linux: `$XDG_DATA_HOME/cowboy` or `~/.local/share/cowboy`
- Windows: `%LOCALAPPDATA%\Cowboy`

Canonical skills live under `skills/<name>/`.

Projects also expose each attached skill at `.cowboy/skills/<name>/`, but that path is a symlink or junction to the global canonical package.

## Agent views

Cowboy does not copy skills into agent folders anymore.

Instead it builds global agent-specific views under:

- `agent-views/claude/<name>/`
- `agent-views/codex/<name>/`

Then each project links:

- `.claude/skills/<name>/` to the global Claude view
- `.agents/skills/<name>/` to the global Codex view

This keeps one canonical skill package while still allowing agent-specific files such as Codex `agents/openai.yaml`.

## Registries

Cowboy tracks skills in two places:

- Global registry: `registry.yaml` in the global Cowboy data directory
  - stores source metadata, hashes, generation metadata, install dates, and linked projects
- Project registry: `.cowboy/installed.yaml`
  - stores only the project's relationship to a skill: `name`, `added_at`, `installed_for`, `disabled_for`

At runtime Cowboy merges both registries into a richer in-memory view.

## Generation and updates

Generation still happens in an isolated temporary workspace.

The agent writes real files inside that workspace, Cowboy validates the result, and then:

1. writes the canonical package into the global library
2. refreshes the global agent views
3. links the skill into the target project and agents

Updates to generated skills edit the linked `.cowboy/skills/<name>/` path in the project, which resolves back to the canonical global package.

## Built-in skills

Cowboy ships with a built-in `skill-creator` skill under `src/skills/skill-creator/`.

It is injected into generation workspaces as an internal dependency and is not installed into every project by default.
