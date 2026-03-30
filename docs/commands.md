# Commands

## `cowboy init`

Initializes Cowboy in the current project.

What it does:

1. Asks which agents should receive installed skills by default
2. Asks which agent should generate and update skills by default
3. Creates `.cowboy/config.yaml`
4. Creates the required project link directories
5. Stores default Claude model/effort and Codex reasoning effort for future generation and update runs

## `cowboy install <github-url>`

Scans a GitHub repo for `SKILL.md` files, stores the selected skills in the global Cowboy library, and adds them to the current project.

Options:

- `--all` installs every discovered skill without prompting
- `--install-for <agent>` is repeatable and also accepts comma-separated values

If a skill with the same name already exists globally, Cowboy reuses it and links it into the current project instead of duplicating it.

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

- `--name <name>` to force the generated skill name; generation fails if that name already exists globally
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

## `cowboy add <name>`

Adds an existing global skill to the current project and activates it for the selected agents.

Options:

- `--install-for <agent>` is repeatable and also accepts comma-separated values

Without `--install-for`, Cowboy uses the configured agents from `.cowboy/config.yaml` or falls back to detected agent directories.

## `cowboy update [name]`

Updates the skills currently added to the project.

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

Lists the skills added to the current project and their source metadata.

Output includes:

- whether a skill is `builtin`, `imported`, or `generated`
- which agents it is installed for
- which agents are currently disabled
- source repos, research query, or docs metadata when available

## `cowboy list --all`

Lists every skill in the global Cowboy library and marks whether each one is currently added to the project.

## `cowboy enable <name>`

Re-enables a previously disabled skill from the global canonical package linked at `.cowboy/skills/<name>/`.

Options:

- `--agent <type>` enables only `claude` or `codex`

Without `--agent`, Cowboy re-enables the skill for every currently disabled install target.

## `cowboy disable <name>`

Disables a skill without removing it from Cowboy's registry.

Options:

- `--agent <type>` disables only `claude` or `codex`

Without `--agent`, Cowboy removes the skill from every active agent target in the project but keeps the project link and global metadata.

## `cowboy remove <name>`

Removes the skill from the current project only.

This deletes the local `.cowboy/skills/<name>` link and agent links, but keeps the canonical package in the global library.

## `cowboy remove <name> --global`

Removes the skill from the global Cowboy library.

Behavior:

- rejects if the skill is still linked in one or more projects
- accepts `--force` to remove it globally and clean up linked projects

## `cowboy agents`

Shows the detected agents in the current project.
