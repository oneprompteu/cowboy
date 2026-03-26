# Cowboy

Cowboy installs, generates, and updates skills for AI coding agents.

It currently targets:

- Claude Code
- Codex

## What Cowboy solves

Without Cowboy, teams usually end up doing one of two things:

1. Copying skills by hand into the right agent-specific directory
2. Writing `SKILL.md` files manually from docs and letting them drift over time

Cowboy automates both the installation path and the generated-skill workflow.

## Quick start

```bash
# Initialize Cowboy in the current project
cowboy init
# During init:
# - choose installation targets
# - choose the default generation/update agent
# - choose default Claude model/effort
# - choose default Codex reasoning effort

# Install skills from a repo
cowboy install https://github.com/anthropics/awesome-claude-skills
cowboy install https://github.com/anthropics/awesome-claude-skills --install-for codex

# Generate from a free-text topic
cowboy generate langchain

# Generate from a repo
cowboy generate --repo https://github.com/microsoft/playwright

# Generate with one agent and install for another
cowboy generate --repo https://github.com/microsoft/playwright --agent codex --install-for claude

# Override runtime settings for a single run
cowboy generate --repo https://github.com/anthropics/anthropic-sdk-typescript --agent claude --claude-model sonnet --effort max
```

## Core idea

Generated skills are authored as real files in the project under `.cowboy/skills/<name>/`.

Cowboy then installs those files for the configured destination agents:

- Claude Code: `.claude/skills/<name>/`
- Codex: `.agents/skills/<name>/`

## Documentation map

- [Commands](commands.md) for the CLI surface
- [Generation](generation.md) for repo/topic generation behavior
- [Architecture](architecture.md) for storage layout and source of truth
- [Maintainers](maintainers.md) for repository governance, CI, and release operations
