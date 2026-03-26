# Cowboy

The easiest way to equip AI coding agents with skills — and keep them up to date.

Cowboy installs, generates, and updates skills for **Claude Code** and **Codex**, so your agents are actually good at the tasks you need them for.

## The problem

You want your AI agent to be good at X (testing with Playwright, using Stripe's SDK, following your team's TDD workflow...). Today you either:

1. **Copy skills manually** from GitHub repos into the right directories for each agent
2. **Write SKILL.md files by hand** from documentation, which get stale as libraries evolve

Cowboy automates both.

## Install

```bash
npm install -g cowboy-cli
```

The package is published as `cowboy-cli`, but the command is just `cowboy`.

Requires Node.js >= 18.

## Quick start

```bash
# 1. Initialize in your project (choose your agents interactively)
cowboy init

# 2. Install skills from a GitHub repo
cowboy install https://github.com/ComposioHQ/awesome-claude-skills

# 3. Or generate a new skill from a topic or repo
cowboy generate langchain
cowboy generate --repo https://github.com/langchain-ai/deepagents
```

That's it. Your agents now have the skills installed in the right places.

## Documentation

Additional project documentation lives in `docs/` and can be served locally with MkDocs.

- `docs/index.md` — overview and quick start
- `docs/commands.md` — command reference
- `docs/generation.md` — repo-based and topic-based generation flow
- `docs/architecture.md` — canonical skill layout and install model

## Commands

### `cowboy init`

Interactive setup: choose which agents you use, and Cowboy creates the necessary directories and `.cowboy/config.yaml`. Also installs built-in skills (like `skill-creator`, which teaches your agent how to create new skills).

If you configure only one agent, Cowboy stores it as the default agent automatically.

```bash
cowboy init
# ? Which agents do you use? (select with space)
#   ◉ Claude Code
#   ◉ Codex
# ✓ Built-in skill: skill-creator
# Cowboy initialized.
# Agents: claude, codex
```

### `cowboy install <github-url>`

Scans a GitHub repo for skills, lets you pick which ones to install, and places them in the correct directories for each of your agents. Skills can be a single SKILL.md or an entire directory with scripts, references, and assets — Cowboy copies everything.

```bash
# Interactive selection
cowboy install https://github.com/ComposioHQ/awesome-claude-skills

# Install all skills from the repo
cowboy install https://github.com/ComposioHQ/awesome-claude-skills --all
```

What happens:
1. Shallow-clones the repo
2. Finds all `SKILL.md` files and their companion files (scripts, references, assets)
3. You select which skills you want (or use `--all`)
4. Copies the entire skill directory for each agent:
   - **Claude Code**: `.claude/skills/{name}/`
   - **Codex**: `.agents/skills/{name}/`
5. Tracks the installation in `.cowboy/installed.yaml`

### `cowboy generate [topic]`

Generates a new skill from either a free-text topic or a library repo using your AI agent (Claude Code or Codex CLI).

```bash
cowboy generate langchain
cowboy generate --repo https://github.com/langchain-ai/deepagents
cowboy generate --repo https://github.com/stripe/stripe-node --name stripe-payments
cowboy generate langchain --agent codex
```

What happens:
1. If you pass `--repo`, Cowboy shallow-clones the library repo and exposes it to the agent
2. If you pass free text like `langchain`, Cowboy starts a topic-oriented agent session instead
3. Selects the agent to use:
   - uses `--agent` if provided
   - otherwise uses the configured default agent if one exists
   - otherwise asks you to choose when multiple agents are configured
4. Starts a real interactive Claude/Codex session in an isolated temporary workspace
5. The agent writes the portable skill directly to `.cowboy/skills/{name}/`
6. Cowboy syncs that canonical skill into every configured agent directory through the corresponding adapter

No API keys needed — uses your existing Claude Code or Codex subscription.

### `cowboy update [name]`

Updates installed skills. Two strategies depending on how the skill was installed:

```bash
# Update all skills
cowboy update

# Update a specific skill
cowboy update playwright
```

- **Imported skills** (from `install`): re-fetches from the source repo, compares content hash (covers all files, not just SKILL.md), replaces if changed. Deterministic.
- **Generated skills** (from `generate`):
  - repo-based: clones the library repo, checks `git log` for changes since last update, then opens a real AI agent session so the skill in `.cowboy/skills/{name}/` can be updated in place.
  - topic-based: opens a fresh research session using the saved query and updates the skill in place from current official sources.

### `cowboy default-agent <agent>`

Sets the default agent Cowboy should use when `generate` needs an agent choice and no `--agent` flag is passed.

```bash
cowboy default-agent claude
cowboy default-agent codex
```

### `cowboy list`

Shows all installed skills with their type and which agents they're installed for.

```bash
cowboy list
#   skill-creator  builtin  [claude, codex]
#   tdd-workflow  imported  [claude, codex]
#     https://github.com/ComposioHQ/awesome-claude-skills
#   playwright  generated  [claude]
#     https://github.com/langchain-ai/deepagents
#
# 3 skill(s) installed.
```

### `cowboy remove <name>`

Removes a skill's files from all agents and cleans up tracking.

```bash
cowboy remove tdd-workflow
# ✓ Removed tdd-workflow
```

### `cowboy agents`

Shows which agents are detected in the current project.

```bash
cowboy agents
# Detected agents:
#   ● claude
#   ● codex
```

## How it works

### What is a skill

A skill is a self-contained package that extends an AI agent's capabilities. It can be as simple as a single SKILL.md file, or a full directory with scripts, references, and assets:

```
skill-name/
├── SKILL.md              (required — YAML frontmatter + markdown instructions)
├── scripts/              (optional — executable code: Python, Bash, etc.)
│   └── extract.py
├── references/           (optional — docs loaded into context as needed)
│   └── api-docs.md
└── assets/               (optional — files used in output, not loaded into context)
    └── template.html
```

### SKILL.md format

Every skill has a SKILL.md with YAML frontmatter and a markdown body:

```markdown
---
name: tdd-workflow
description: "Red-Green-Refactor TDD workflow"
---

# TDD Workflow

Always write the test first...
```

The `name` and `description` fields are required. The body contains practical guidance for the AI agent. Companion files (scripts, references, assets) are referenced from the body.

### Agent differences

| | Claude Code | Codex |
|---|---|---|
| Installed form | `.claude/skills/{name}/SKILL.md` | `.agents/skills/{name}/SKILL.md` |
| Companion files | `.claude/skills/{name}/...` | `.agents/skills/{name}/...` |
| Project instructions | `CLAUDE.md` | `AGENTS.md` |

Cowboy handles these differences automatically through adapters. You write one skill, it gets installed correctly for each agent.
Cowboy treats `.cowboy/skills/{name}/` as the portable source of truth, then adapts it per agent. Optional Codex metadata such as `agents/openai.yaml` is preserved in the canonical package, copied into `.agents/skills`, and ignored for Claude installs.
Cowboy manages project-local installs. It does not write to user-level Codex skill directories such as `~/.codex/skills`.

### Project structure

After running Cowboy, your project gets:

```
your-project/
├── .cowboy/
│   ├── config.yaml        # Configured agents
│   ├── installed.yaml     # Installed skills registry
│   └── skills/            # Canonical source for generated skills
│       └── pdf-editor/
│           ├── SKILL.md
│           ├── scripts/
│           │   └── rotate.py
│           └── references/
│               └── api-docs.md
├── .claude/
│   └── skills/
│       ├── skill-creator/
│       │   └── SKILL.md
│       └── pdf-editor/
│           ├── SKILL.md
│           ├── scripts/
│           │   └── rotate.py
│           └── references/
│               └── api-docs.md
└── .agents/
    └── skills/
        └── pdf-editor/
            ├── SKILL.md
            ├── scripts/
            │   └── rotate.py
            ├── references/
            │   └── api-docs.md
```

### Built-in skills

Cowboy ships with a `skill-creator` skill that teaches your AI agent how to create well-structured skills — covering the directory anatomy, when to use scripts vs references vs assets, and the progressive disclosure design principle.
It also instructs the agent to prefer official documentation and maintainer sources, and to save a concise bibliography when external research matters.

### AI generation

The `generate` and `update` commands use your local AI agent CLI:

- **Claude Code**: runs `claude "prompt" --add-dir <cloned-repo>` in interactive mode
- **Codex**: runs `codex -s workspace-write --add-dir <cloned-repo> "prompt"` in interactive mode and `codex exec --full-auto -s workspace-write --skip-git-repo-check ...` in headless mode

The agent works directly in your project and writes the skill to `.cowboy/skills/`. Cowboy then installs it for the configured agent. No separate API keys, no extra costs.

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Type check
npx tsc --noEmit

# Serve docs locally
python3 -m mkdocs serve

# Build docs
python3 -m mkdocs build

# Build
pnpm build

# Local testing (after build)
npm link
```

## License

MIT
