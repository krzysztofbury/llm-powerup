# Releasing

Every merge to `main` is a release. There is no manual tagging and no release
branch: when CI passes on `main`, the `Release` workflow
(`.github/workflows/release.yml`) tags the merge commit with the next
[semantic version](https://semver.org/) and publishes a GitHub release.

This file is for the maintainer and for agents preparing a pull request.

## Versions

Versions are `vMAJOR.MINOR.PATCH`. The first release is `v1.0.0`.

| Bump | Pull request label | Use it when |
| --- | --- | --- |
| Major | `release:major` | Someone who updates must change something on their side: a skill is removed or renamed, an installer flag or the sources file format changes incompatibly, a configuration key or environment variable is renamed or removed, a hook starts refusing or asking for commands it allowed before, or the base rules change their meaning. |
| Minor | `release:minor` | Something new that does not break existing setups: a new skill, hook, integration, installer option, configuration setting, or a skill gaining a capability. |
| Patch | none, or `release:patch` | Fixes, wording, documentation, tests, CI, and internal refactoring. |

No label means a patch release. If a pull request carries several release
labels, the largest wins.

## Preparing a pull request

1. Choose the bump from the table and add the label to the pull request.
2. Compute the version it will get:

   ```bash
   scripts/next-version.sh minor --remote   # major, minor or patch
   ```

3. In `CHANGELOG.md`, add a section for that version at the top, under the
   introduction, using the [Keep a Changelog](https://keepachangelog.com/)
   groups that apply (`Added`, `Changed`, `Fixed`, `Removed`, `Security`):

   ```markdown
   ## [1.3.0] - 2026-11-20

   ### Added

   - `example-skill`: what it does, in one line.
   ```

   That section becomes the release notes. Use the merge date when you know
   it; the day you open the pull request is fine otherwise.
4. Run the validation commands from [SPEC.md](SPEC.md).

If another pull request is merged first, the version moves on. Rebase,
recompute the version, and rename your changelog heading before merging. If
the changelog has no section for the released version, the release notes fall
back to the pull request title and description, so a missed rename never
blocks a release, but the changelog is then out of step and needs a follow-up.

## What the workflow does

1. Runs only after the `CI` workflow succeeds for a push to `main`.
2. Skips the commit if it already carries a `v*` release tag, so a re-run never
   releases twice.
3. Finds the merged pull request for the commit and reads its labels. A
   commit pushed directly to `main` without a pull request is a patch.
4. Computes the version with `scripts/next-version.sh` from the highest
   existing `vX.Y.Z` tag.
5. Takes the notes from `CHANGELOG.md` with `scripts/release-notes.sh`, or
   from the pull request, and adds a compare link to the previous release.
6. Creates the tag and the release with `gh release create`.

The workflow never pushes to `main`; it only creates tags and releases.

## For agents

- Never create, move, or delete `v*` tags or releases by hand. The workflow
  owns them. To fix a bad release, merge a follow-up pull request.
- Always set the release label when opening a pull request, and say in the
  pull request description which bump you chose and why.
- When unsure between two bumps, choose the larger one and say so.
- Check the result after a merge:

  ```bash
  gh run list --workflow Release --limit 1
  gh release view --json tagName,targetCommitish,url
  ```
