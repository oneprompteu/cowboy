# Generation

Cowboy supports two generated-skill modes.

## Agent selection

When generation starts, Cowboy chooses the agent in this order:

1. `--agent <agent>` if you pass it explicitly
2. `default_agent` from `.cowboy/config.yaml` if one is configured
3. an interactive prompt if multiple configured agents remain possible

If only one agent is configured, Cowboy uses it directly.

## Repo-based generation

Example:

```bash
cowboy generate --repo https://github.com/microsoft/playwright
```

Flow:

1. Cowboy clones the target repo
2. Cowboy resolves which configured agent should handle generation
3. Cowboy opens a real Claude/Codex session in the current project
4. The cloned repo is exposed to the agent as reference material
5. The agent writes the skill to `.cowboy/skills/<name>/`
6. Cowboy installs that skill for the chosen agent

## Topic-based generation

Example:

```bash
cowboy generate langchain
```

Flow:

1. Cowboy opens a real Claude/Codex session in the current project
2. Cowboy resolves which configured agent should handle generation
3. The agent identifies the canonical project, package, framework, or specification behind the topic
4. When external research is needed, the agent prefers official documentation, maintainer repositories, package indexes, and other primary sources
5. The agent writes the skill to `.cowboy/skills/<name>/`
6. Cowboy installs that skill for the chosen agent

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
