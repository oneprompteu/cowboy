# Commands

## `cowboy init`

Initializes Cowboy in the current project.

What it does:

1. Asks which agents should receive installed skills by default
2. Asks which agent should generate and update skills by default
3. Creates `.cowboy/config.yaml`
4. Creates the required agent directories
5. Installs built-in skills such as `skill-creator`
6. Stores default Claude model/effort and Codex reasoning effort for future generation and update runs

## `cowboy install <github-url>`

Scans a GitHub repo for `SKILL.md` files and installs the selected skills.

Options:

- `--all` installs every discovered skill without prompting
- `--install-for <agent>` is repeatable and also accepts comma-separated values

Cowboy writes the installed files into each target agent directory and stores source metadata in `.cowboy/installed.yaml`.

Install target behavior:

1. Use `--install-for <agent>` if passed
2. Otherwise use the configured agents from `.cowboy/config.yaml`
3. Otherwise fall back to detected agent directories

## `cowboy generate [topic]`

Generates a skill through a real Claude/Codex agent session.

Supported modes:

- Free-text topic: `cowboy generate langchain`
- Repo-based: `cowboy generate --repo https://github.com/microsoft/playwright`
- Docs-only: `cowboy generate --docs https://playwright.dev/docs/intro`
- Hybrid repo plus docs: `cowboy generate --repo https://github.com/microsoft/playwright --docs ~/docs/playwright`

Source behavior:

- `--repo <url>` is repeatable, so one skill can be synthesized from multiple repositories
- `--docs <source>` is repeatable and accepts either an HTTP URL or a local directory path
- local docs directories are resolved relative to the current project directory and mounted into the agent session
- you may combine `--docs` with `--repo` or with a free-text topic
- you may not combine `--repo` with a free-text topic in the same command

Optional flags:

- `--name <name>` to force the generated skill name
- `--agent <agent>` to force `claude` or `codex`
- `--claude-model <model>` to override Claude's model for the current run
- `--effort <level>` to override the selected agent's thinking/reasoning effort for the current run
- `--install-for <agent>` to choose which configured agents receive the generated skill

Agent selection behavior:

1. Use `--agent` if passed
2. Otherwise use `default_agent` from `.cowboy/config.yaml` if present
3. Otherwise prompt when multiple local agent CLIs are available

Install target behavior:

1. Use `--install-for <agent>` if passed
2. Otherwise install for the configured agents in `.cowboy/config.yaml`
3. Otherwise fall back to detected agent directories

## `cowboy update [name]`

Updates installed skills.

Behavior depends on skill type:

- Imported skills are refreshed deterministically from their source repo
- Generated skills with stored repo sources are only regenerated when Cowboy detects upstream changes
- Generated skills with only `doc_urls` are refreshed from those documentation sources
- Generated skills with a free-text `research_query` are refreshed through a fresh research session

Optional flags:

- `--agent <agent>` to override which agent performs the update
- `--claude-model <model>` to override Claude's model for that update run
- `--effort <level>` to override the selected agent's thinking/reasoning effort

If the target set includes generated skills, Cowboy requires a working Claude Code or Codex CLI for the update run.

## `cowboy default-agent <agent>`

Sets the default agent Cowboy should use for generation when no `--agent` flag is passed.

## `cowboy list`

Lists installed skills and their source metadata.

Output includes:

- whether a skill is `builtin`, `imported`, or `generated`
- which agents it is installed for
- which agents are currently disabled
- source repos, research query, or docs metadata when available

## `cowboy enable <name>`

Re-enables a previously disabled skill from its canonical copy in `.cowboy/skills/<name>/`.

Options:

- `--agent <type>` enables only `claude` or `codex`

Without `--agent`, Cowboy re-enables the skill for every currently disabled install target.

## `cowboy disable <name>`

Disables a skill without removing it from Cowboy's registry.

Options:

- `--agent <type>` disables only `claude` or `codex`

Without `--agent`, Cowboy removes the skill from every installed agent target but keeps its canonical copy and metadata.

## `cowboy remove <name>`

Removes the installed skill files and, for generated skills, also removes the canonical source in `.cowboy/skills/<name>/`.

## `cowboy agents`

Shows the detected agents in the current project.
