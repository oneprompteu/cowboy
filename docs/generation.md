# Generation

Cowboy supports two generated-skill modes.

## Agent selection

When generation starts, Cowboy chooses the agent in this order:

1. `--agent <agent>` if you pass it explicitly
2. `default_agent` from `.cowboy/config.yaml` if one is configured
3. an interactive prompt if multiple local agent CLIs are available

If only one local AI agent CLI is available, Cowboy uses it directly.

## Install target selection

Generation and installation are separate concerns:

- `--agent` decides which local AI agent creates or updates the skill
- `--install-for` decides which configured agents receive the resulting skill package
- `--claude-model` overrides Claude's model for the current run
- `--effort` overrides the selected agent's thinking/reasoning effort for the current run

Cowboy only overrides the model for Claude. For Codex, Cowboy keeps the configured/default model and only adjusts reasoning effort.
Claude's `max` effort is model-dependent; Anthropic documents it as Opus 4.6-only in the CLI reference.

When `--install-for` is omitted, Cowboy installs for all configured agents. If Cowboy has not been initialized yet, it falls back to the detected agent directories.

## Runtime defaults

`cowboy init` stores runtime defaults per agent:

- Claude Code: model plus effort
- Codex: reasoning effort

Cowboy uses those defaults automatically for `generate` and `update`, unless you override them on the command line.

## Repo-based generation

Example:

```bash
cowboy generate --repo https://github.com/microsoft/playwright
```

Flow:

1. Cowboy clones the target repo
2. Cowboy resolves which agent CLI should handle generation
3. Cowboy opens a real Claude/Codex session in an isolated temporary workspace
4. The cloned repo is exposed to the agent as reference material
5. The agent writes the skill to `.cowboy/skills/<name>/` inside that isolated workspace
6. Cowboy syncs the canonical skill back to the real project and installs it for the requested target agents

## Topic-based generation

Example:

```bash
cowboy generate langchain
```

Flow:

1. Cowboy opens a real Claude/Codex session in an isolated temporary workspace
2. Cowboy resolves which agent CLI should handle generation
3. The agent identifies the canonical project, package, framework, or specification behind the topic
4. When external research is needed, the agent prefers official documentation, maintainer repositories, package indexes, and other primary sources
5. The agent writes the skill to `.cowboy/skills/<name>/` inside that isolated workspace
6. Cowboy syncs the canonical skill back to the real project and installs it for the requested target agents

## Skill-creator expectations

Cowboy ships with a built-in `skill-creator` skill.

That skill now instructs the agent to:

- identify the canonical project when starting from free text
- prefer official documentation and maintainer-owned sources
- fall back to third-party tutorials only when official material is incomplete
- keep a concise bibliography in `references/sources.md` when external research matters

## Updates

Repo-based generated skills:

- use `git log` on the stored repo to detect whether an update is needed
- if needed, reopen a real agent session and update `.cowboy/skills/<name>/`

Topic-based generated skills:

- store the original free-text query
- reopen a fresh research session on update
- refresh the skill from current official sources
