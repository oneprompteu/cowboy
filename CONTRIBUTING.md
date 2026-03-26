# Contributing to Cowboy

Thanks for contributing. Cowboy should stay predictable for maintainers and portable across agent ecosystems.

## Development setup

```bash
pnpm install
pnpm test
pnpm build
```

Requirements:

- Node.js `>= 20.12.0`
- `pnpm` 9

## How to contribute

1. Fork the repository.
2. Create a branch from `main` using a descriptive name such as `feature/...`, `fix/...`, or `docs/...`.
3. Make the smallest coherent change that solves one problem.
4. Run `pnpm test` and `pnpm build`.
5. Update docs when behavior, commands, or public workflows change.
6. Open a pull request with a clear problem statement and validation notes.

## Contribution guidelines

- Keep skills portable across supported agents whenever possible.
- Avoid agent-specific logic in core workflows unless the behavior is explicitly adapter-bound.
- Preserve the canonical source of truth in `.cowboy/skills/`.
- Prefer deterministic CLI behavior over hidden automation.
- Add or update tests for new features and bug fixes.
- Keep README and `docs/` aligned with the shipped CLI.

## Pull request checklist

- Tests pass locally.
- New behavior is covered by tests when applicable.
- Docs are updated when the user-facing behavior changed.
- Breaking changes are clearly called out in the PR description.

## Reporting bugs and proposing features

- Use the GitHub issue templates for bugs and feature requests.
- For security issues, follow `SECURITY.md` and do not open a public issue.
