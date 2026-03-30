# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-03-30

### Added

- Global Cowboy skill library with per-project links and agent-specific linked
  views for Claude Code and Codex
- `cowboy add <name>` to attach an existing global skill to the current project
- `cowboy list --all` to inspect the global Cowboy library and whether each
  skill is linked into the current project
- Automatic migration from legacy project-local `.cowboy/skills/` installs into
  the global library
- Cross-platform global storage resolution for macOS, Linux, and Windows, with
  `COWBOY_DATA_DIR` override support
- Open source governance docs: contributing guide, code of conduct, security
  policy, and maintainer guide
- GitHub issue templates, pull request template, and CI workflow
- Package metadata for repository, homepage, bug tracker, and publishable files

### Changed

- Canonical skill storage moved from project-local `.cowboy/skills/` copies to
  a user-level global Cowboy library
- `cowboy install` now reuses existing global skills instead of duplicating
  canonical files across projects
- `cowboy remove` now removes a skill from the current project by default;
  `cowboy remove --global` removes it from the global library
- `cowboy update` now updates the skills linked into the current project, and
  `cowboy list` focuses on project-linked skills by default
- `cowboy init` no longer installs built-in skills into every project;
  `skill-creator` is injected only into isolated generation workspaces
- Declared the supported Node.js runtime as `>= 20.12.0`
- Repositioned the README around Cowboy as the package manager for AI agent
  skills

### Fixed

- Preserved symlinked skill contents during scanning and agent sync flows
- Prevented skill name collisions during generation and legacy-project
  migration into the global library
- Ensured the packaged CLI entrypoint is executable with
  `chmod +x dist/cli/index.js`

## [0.1.0] - 2026-03-26

### Added

- Initial CLI for installing, generating, updating, enabling, disabling, and
  removing AI agent skills
- Project-local canonical skill storage in `.cowboy/skills/`
- Multi-agent sync for Claude Code and Codex
- Documentation for commands, architecture, and generation flows
