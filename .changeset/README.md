# Changesets

This folder holds [changesets](https://github.com/changesets/changesets) — one
markdown file per set of changes, describing the version bump and changelog entry.

Add one with `npx changeset`, then `npx changeset version` bumps `package.json`
and updates the changelog. Publishing happens in CI on a pushed `v*` tag.
