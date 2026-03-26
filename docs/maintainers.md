# Maintainers

This document covers the repository settings and release workflow that keep
Cowboy reliable as an open source project.

## GitHub repository settings

Recommended repository settings:

- Allow forking
- Require pull requests before merging into `main`
- Disable direct pushes to `main`
- Disable force pushes on protected branches

## Branch protection for `main`

Enable the following rules:

- Require a pull request before merging
- Require at least one approval
- Dismiss stale approvals when new commits are pushed
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Block direct pushes

The `CI` workflow in `.github/workflows/ci.yml` is the required status check.

## Release policy

Cowboy uses Semantic Versioning:

- `MAJOR` for breaking CLI or package format changes
- `MINOR` for backward-compatible features
- `PATCH` for backward-compatible fixes

Before a release:

1. Update `package.json`
2. Move relevant entries from `Unreleased` into a new `CHANGELOG.md` section
3. Run `pnpm test` and `pnpm build`
4. Tag the release in GitHub and publish release notes

## Documentation site

The documentation site is built from `docs/` with MkDocs using
`mkdocs.yml`.

GitHub Pages deployment is handled by the `Docs` workflow in
`.github/workflows/docs.yml`.

Repository setup:

1. Open `Settings -> Pages`
2. Set `Source` to `GitHub Actions`
3. Push to `main` or run the `Docs` workflow manually

Local preview:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-docs.txt
mkdocs serve
```

## Security operations

- Keep GitHub Private Vulnerability Reporting enabled if available
- Do not ask reporters to disclose vulnerabilities in public issues
- Backport fixes only when there is an explicitly supported release branch
