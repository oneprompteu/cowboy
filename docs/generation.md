# Generation

Cowboy supports three generated-skill modes and can combine documentation sources with two of them.

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

Cowboy only overrides the model for Claude. For Codex, Cowboy keeps the configured or default model and only adjusts reasoning effort.
Claude's `max` effort is model-dependent; Anthropic documents it as Opus 4.6-only in the CLI reference.

When `--install-for` is omitted, Cowboy installs for all configured agents. If Cowboy has not been initialized yet, it falls back to the detected agent directories.

## Runtime defaults

`cowboy init` stores runtime defaults per agent:

- Claude Code: model plus effort
- Codex: reasoning effort

Cowboy uses those defaults automatically for `generate` and `update`, unless you override them on the command line.

## Source modes

### Repo-based generation

Examples:

```bash
cowboy generate --repo https://github.com/microsoft/playwright
cowboy generate --repo https://github.com/langchain-ai/deepagents --repo https://github.com/langchain-ai/langgraph
```

You can also attach documentation sources:

```bash
cowboy generate --repo https://github.com/microsoft/playwright --docs https://playwright.dev/docs/intro
```

Flow:

1. Cowboy clones the requested repository or repositories
2. When multiple `--repo` values are passed, Cowboy asks the agent to synthesize one unified skill from all of them
3. Any `--docs` sources are resolved before the session starts
4. Cowboy opens a real Claude/Codex session in an isolated temporary workspace
5. Cloned repos are exposed to the agent as reference material
6. Local docs directories from `--docs` are mounted into the session; web docs are passed as URLs
7. The agent writes the skill to `skills/<name>/` inside that isolated workspace
8. Cowboy stores the canonical package in the global library, refreshes the agent views, and links it into the requested project agents

### Docs-only generation

Examples:

```bash
cowboy generate --docs https://playwright.dev/docs/intro
cowboy generate --docs ~/docs/playwright
cowboy generate --docs https://playwright.dev/docs/intro --docs ~/docs/playwright
```

Flow:

1. Cowboy resolves each docs source as either a web URL or a local directory
2. Cowboy opens a real Claude/Codex session in an isolated temporary workspace
3. Local docs directories are mounted into the session directly
4. The agent builds the skill from those documentation sources and any primary repos it discovers
5. Cowboy stores the canonical package in the global library, refreshes the agent views, and links it into the requested project agents

### Topic-based generation

Examples:

```bash
cowboy generate langchain
cowboy generate stripe api --docs https://docs.stripe.com/api
```

Flow:

1. Cowboy opens a real Claude/Codex session in an isolated temporary workspace
2. Any `--docs` sources are resolved and passed into the session
3. The agent identifies the canonical project, package, framework, or specification behind the topic
4. When external research is needed, the agent prefers official documentation, maintainer repositories, package indexes, and other primary sources
5. The agent writes the skill to `skills/<name>/` inside that isolated workspace
6. Cowboy stores the canonical package in the global library, refreshes the agent views, and links it into the requested project agents

## Constraints

- `--repo` and a free-text topic are mutually exclusive in the same command
- `--docs` can be combined with either `--repo` or a free-text topic
- at least one of `--repo`, `--docs`, or a topic is required
- local docs paths must exist and must be directories
- Cowboy de-duplicates repeated docs sources before launching the agent

## Skill-creator expectations

Cowboy ships with a built-in `skill-creator` skill.

That skill instructs the agent to:

- identify the canonical project when starting from free text
- prefer official documentation and maintainer-owned sources
- fall back to third-party tutorials only when official material is incomplete
- keep longer technical material in companion files when it materially improves the package
- record discovered GitHub repositories in `sources.yaml` so Cowboy can track them later

## Updates

Repo-based generated skills:

- store discovered source repositories and commit hashes in the global Cowboy registry
- use those stored repos to detect whether an update is needed
- reopen a real interactive agent session only when upstream changes are detected
- can also carry forward any stored `doc_urls` used during the original generation

Topic-based generated skills:

- store the original free-text query
- reopen a fresh research session on update
- refresh the skill from current official sources

Docs-only generated skills:

- store their `doc_urls` in the global Cowboy registry
- reopen an interactive agent session against those documentation sources on update
- can also persist any GitHub repositories the agent discovered as primary sources during generation or update
