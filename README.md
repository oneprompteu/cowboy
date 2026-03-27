<p align="center" style="margin: 0 0 8px 0;">
  <img src="https://raw.githubusercontent.com/oneprompteu/cowboy/main/assets/cowboys.png" alt="Cowboy cover art" width="72%" />
</p>

<h1 align="center" style="margin: 0; font-size: 5rem; line-height: 1;">🤠 cowboy</h1>

<p align="center" style="margin: 8px 0 0 0;"><strong>The package manager for AI agent skills.</strong></p>

<p align="center" style="margin: 8px 0 0 0;">
Cowboy helps you create, install, and update AI agent skills with simple commands.
</p>

<p align="center" style="margin: 8px 0 0 0;">
  <a href="https://github.com/oneprompteu/cowboy/tree/main/docs"><strong>Documentation</strong></a> · <strong>MIT License</strong>
</p>

---

## Quick Index

* [Why Cowboy](#why-cowboy)
* [What Makes Cowboy Different](#what-makes-cowboy-different)
* [Features](#features)
* [Installation](#installation)
* [Quick Start](#quick-start)
* [Core Workflows](#core-workflows)
* [How Cowboy Works](#how-cowboy-works)
* [Documentation](#documentation)
* [License](#license)

---

# Why Cowboy

AI coding agents get **dramatically better** when they have strong, task-specific instructions.

But today, skills are:

* copied manually between repos
* duplicated across agent ecosystems
* outdated after a few weeks
* hard to maintain
* impossible to version properly

Cowboy fixes this.

It gives you a **single project-local source of truth** for skills that can be:

* installed from GitHub
* generated automatically from docs or repos
* synced to multiple agents
* updated to latest versions
* enabled or disabled per agent
* maintained over time

All with a simple CLI.

And most importantly:

**Cowboy uses your existing Codex or Claude Code subscription.**
No API keys. No extra cost. No vendor lock-in.

---

# What Makes Cowboy Different

## Auto-updating skills

Install a skill once.
Update it anytime.

```bash
cowboy update
```

Cowboy re-fetches imported skills and regenerates AI-authored ones using the latest docs or repos.

Your agents always stay up to date.

---

## Generate skills automatically

Create new skills from:

* GitHub repositories
* documentation URLs
* local documentation directories
* free-text topics

```bash
cowboy generate playwright testing
cowboy generate --repo https://github.com/langchain-ai/deepagents
cowboy generate --docs https://docs.stripe.com/api
cowboy generate --docs ~/docs/stripe-api
cowboy generate --repo https://github.com/langchain-ai/deepagents --docs ~/docs/deepagents
```

Cowboy uses **your local agent CLI** to generate the skill — completely free.

---

## Multi-agent sync

Install once.
Use everywhere.

Cowboy syncs the same skill to:

* Claude Code
* Codex

From one canonical package.

---

## One canonical source of truth

Skills live in:

```
.cowboy/skills/{name}/
```

Cowboy syncs them automatically to agent-specific directories.

No drift. No duplication. No manual copy-paste.

---

# Features

| Capability               | What Cowboy does                                   |
| ------------------------ | -------------------------------------------------- |
| Auto updates             | Refresh skills from GitHub or regenerate from docs |
| AI skill generation      | Generate skills from repos, docs, or topics        |
| Multi-agent install      | Sync skills to Claude Code and Codex               |
| Canonical storage        | One source of truth in `.cowboy/skills/`           |
| Repo import              | Install skills from GitHub skill repositories      |
| Free generation          | Uses your own Codex / Claude Code subscription     |
| Explicit install targets | Generate with one agent, install to another        |
| Enable / disable         | Toggle skills per agent without deleting           |
| Version control friendly | Skills are local, portable, and commit-safe        |
| No vendor lock-in        | Works with local agent CLIs                        |

---

# Installation

```bash
npm install -g cowboy-cli
```

For a project-local install:

```bash
npm install cowboy-cli
npx cowboy
```

## Requirements

* Node.js `>= 20.12.0`
* At least one supported agent CLI:

  * Claude Code
  * Codex

The published package name is `cowboy-cli`, and the executable is `cowboy`.

---

# Quick Start

```bash
cowboy init
cowboy install https://github.com/ComposioHQ/awesome-claude-skills
cowboy generate deepagents
cowboy list
cowboy update
```

---

# Core Workflows

## Install skills from GitHub

```bash
cowboy install https://github.com/ComposioHQ/awesome-claude-skills
cowboy install <repo> --install-for claude --install-for codex
```

---

## Generate skills automatically

```bash
cowboy generate langchain
cowboy generate --repo https://github.com/langchain-ai/deepagents
cowboy generate --docs https://playwright.dev/docs/intro
cowboy generate --docs ~/docs
```

`--docs` now accepts either a documentation URL or a local directory path. Local directories are exposed directly to the agent session so it can build the skill from files on disk as well as web docs.

Cross-agent example:

```bash
cowboy generate --repo https://github.com/stripe/stripe-node --agent codex --install-for claude
```

Runtime override:

```bash
cowboy generate \
  --repo https://github.com/langchain-ai/langgraph \
  --agent codex \
  --effort xhigh
```

---

## Update skills

```bash
cowboy update
cowboy update playwright-testing
cowboy update --agent codex --effort high
```

---

# How Cowboy Works

Cowboy manages skills in three layers:

### 1. Discovery or generation

* Imported from GitHub
* Generated from docs/repos/topics

### 2. Canonical storage

```
.cowboy/skills/{name}/
```

Portable and versionable.

### 3. Agent sync

```
.claude/skills/
.agents/skills/
```

Cowboy keeps everything in sync automatically.

---

# Skill Package Format

```
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

Example:

```md
---
name: playwright-testing
description: Reliable browser testing workflows with Playwright
---

# Playwright Testing

Prefer deterministic selectors and isolate flaky test causes before retrying.
```

---

# Project Layout

```
your-project/
├── .cowboy/
│   ├── config.yaml
│   ├── installed.yaml
│   └── skills/
├── .claude/
│   └── skills/
└── .agents/
    └── skills/
```

---

# Supported Agents

| Agent       | Install location         |
| ----------- | ------------------------ |
| Claude Code | `.claude/skills/{name}/` |
| Codex       | `.agents/skills/{name}/` |

Cowboy installs **project-local skills only**.

---

# Commands

```bash
cowboy init
cowboy install <github-url>
cowboy generate [topic]
cowboy update
cowboy list
cowboy enable <name>
cowboy disable <name>
cowboy remove <name>
cowboy agents
cowboy default-agent <agent>
```

---

# Documentation

See `docs/`:

* `docs/index.md`
* `docs/commands.md`
* `docs/generation.md`
* `docs/architecture.md`
* `docs/maintainers.md`

---

# Open Source

Cowboy is structured for external contributors and maintainers:

* `CONTRIBUTING.md` for the contribution workflow
* `CODE_OF_CONDUCT.md` for community expectations
* `SECURITY.md` for responsible disclosure
* `CHANGELOG.md` for release history
* `docs/maintainers.md` for branch protection and release operations

---

# Contributing

See `CONTRIBUTING.md` before opening a pull request.

High-signal defaults:

* Keep skills portable
* Avoid agent-specific assumptions in core flows
* Add tests for behavior changes
* Update docs when CLI behavior changes

```bash
pnpm test
pnpm build
```

---

# License

MIT
