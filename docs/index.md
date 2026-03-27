# 🤠 cowboy

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

# Generate from docs only
cowboy generate --docs https://playwright.dev/docs/intro
cowboy generate --docs ~/docs/playwright

# Combine repo and docs sources
cowboy generate --repo https://github.com/microsoft/playwright --docs https://playwright.dev/docs/intro

# Generate with one agent and install for another
cowboy generate --repo https://github.com/microsoft/playwright --agent codex --install-for claude

# Override runtime settings for a single run
cowboy generate --repo https://github.com/anthropics/anthropic-sdk-typescript --agent claude --claude-model sonnet --effort max

# Toggle a skill without deleting it
cowboy disable playwright-testing --agent codex
cowboy enable playwright-testing --agent codex
```

## Core idea

Cowboy keeps a canonical project-local copy of each skill under `.cowboy/skills/<name>/`.

Generated skills are authored there and then installed for the configured agents.

Cowboy then installs those files for the configured destination agents:

- Claude Code: `.claude/skills/<name>/`
- Codex: `.agents/skills/<name>/`

This lets Cowboy support cross-agent installs, updates, and per-agent enable/disable without duplicating the package definition.

## Documentation map

- [Commands](commands.md) for the CLI surface
- [Generation](generation.md) for repo, docs, and topic generation behavior
- [Architecture](architecture.md) for storage layout and source of truth
- [Maintainers](maintainers.md) for repository governance, CI, and release operations
