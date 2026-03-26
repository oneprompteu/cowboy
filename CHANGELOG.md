# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Open source governance docs: contributing guide, code of conduct, security
  policy, and maintainer guide
- GitHub issue templates, pull request template, and CI workflow
- Package metadata for repository, homepage, bug tracker, and publishable files

### Changed

- Declared the supported Node.js runtime as `>= 20.12.0`
- Repositioned the README around Cowboy as the package manager for AI agent
  skills

## [0.1.0] - 2026-03-26

### Added

- Initial CLI for installing, generating, updating, enabling, disabling, and
  removing AI agent skills
- Project-local canonical skill storage in `.cowboy/skills/`
- Multi-agent sync for Claude Code and Codex
- Documentation for commands, architecture, and generation flows
