# Commands

## `cowboy init`

Initializes Cowboy in the current project.

What it does:

1. Creates `.cowboy/config.yaml`
2. Creates the required agent directories
3. Installs built-in skills such as `skill-creator`
4. If only one agent is selected, stores it as `default_agent`

## `cowboy install <github-url>`

Scans a GitHub repo for `SKILL.md` files and installs the selected skills for the detected agents.

## `cowboy generate [topic]`

Generates a skill through a real Claude/Codex agent session.

Supported modes:

- Free-text topic: `cowboy generate langchain`
- Repo-based: `cowboy generate --repo https://github.com/microsoft/playwright`

Optional flags:

- `--name <name>` to force the generated skill name
- `--agent <agent>` to force `claude` or `codex`

Agent selection behavior:

1. Use `--agent` if passed
2. Otherwise use `default_agent` from `.cowboy/config.yaml` if present
3. Otherwise prompt when multiple configured agents exist

## `cowboy update [name]`

Updates installed skills.

Behavior depends on skill type:

- Imported skills are refreshed deterministically from their source repo
- Generated skills are refreshed through a real agent session

## `cowboy default-agent <agent>`

Sets the default agent Cowboy should use for generation when no `--agent` flag is passed.

## `cowboy list`

Lists installed skills and their source metadata.

## `cowboy remove <name>`

Removes the installed skill files and, for generated skills, also removes the canonical source in `.cowboy/skills/<name>/`.

## `cowboy agents`

Shows the detected agents in the current project.
