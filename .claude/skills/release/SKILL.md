---
name: release
description: Prepare a version-bump PR and publish a verified GitHub Release after approval and merge.
---

# Release

Use this skill to prepare a version-bump PR and, only after the user confirms it is merged, publish the corresponding GitHub Release. Use Bun, Git, and the GitHub CLI (`gh`). Do not initiate an actual PR or release unless the user asked for that work.

## Non-negotiable rules

- Never bump `package.json` on `main`. The only version change belongs on a dedicated release branch and in its PR.
- Never create or push a release tag, run the publish command, or create a GitHub Release before the version-bump PR is merged and the user confirms the merge.
- Stop after opening the version-bump PR. Wait for the user to approve and merge it; do not approve or merge it on the user's behalf, and do not continue release preparation while approval is pending.
- Publish the exact version already merged into `main`. Never increment or rewrite it during publishing.
- Never invent commits, issue references, release details, or verification results. Include an issue or PR reference only when a commit or linked context names it and `gh` confirms it belongs to this release.
- Review the latest release notes and retain useful style, such as concise bold lead-ins and a closing PR-context sentence when it is applicable and verified. Use the required release-note categories below.

## 1. Inspect repository and choose version

Begin with a fetch, worktree check, latest tag/release review, and version preference. From the repository root, run:

```bash
git fetch --tags origin refs/heads/main:refs/remotes/origin/main
git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse refs/remotes/origin/main
gh auth status
latest_tag="$(git describe --tags --abbrev=0 refs/remotes/origin/main)"
gh release list --limit 1
gh release view "$latest_tag"
```

Require a clean worktree on `main` whose `HEAD` equals `origin/main`. If any check fails, stop and report the exact state; do not switch away from uncommitted work, reset, or guess which changes to discard. Inspect `package.json`'s current version. If the latest tag, latest GitHub Release, and package version disagree, stop and reconcile the history before proposing a bump.

Inspect changes since the latest release tag, including commit subjects and the actual diff:

```bash
git log --oneline --decorate "$latest_tag"..origin/main
git diff --stat "$latest_tag"..origin/main
git diff "$latest_tag"..origin/main
```

Calculate all three candidate versions from the current `MAJOR.MINOR.PATCH` in `package.json`:

- patch: `MAJOR.MINOR.(PATCH + 1)`
- minor: `MAJOR.(MINOR + 1).0`
- major: `(MAJOR + 1).0.0`

Use semver impact: breaking compatibility change means major; backward-compatible user-facing capability means minor; compatible fixes and maintenance mean patch. Honor an explicit user bump preference when it matches the change. Otherwise recommend the smallest appropriate bump, state current version, candidates, and evidence, and ask the user for a preference if impact is ambiguous. Do not change files until the target version is clear.

## 2. Prepare and open version PR

Use a new branch based on the fetched `origin/main`, named `release/vX.Y.Z`. If that branch already exists, inspect it and its PR; do not overwrite or force-push it. Update only the `version` value in `package.json` on this branch. Do not change lockfiles, create a tag, or publish from the release branch.

Review `git diff -- package.json` and `git status --short`; confirm the only change is the requested version. Commit and push only `package.json`, then open a PR to `main` with `gh`:

```bash
git switch -c release/vX.Y.Z origin/main
git add package.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z --title "chore(release): vX.Y.Z" --body "Bump package version to vX.Y.Z."
gh pr view release/vX.Y.Z
```

Report the PR URL, exact version, and why the bump fits. **Pause here.** Ask the user to review, approve, and merge the PR. Do not run any post-merge command or publish command until the user explicitly confirms the PR is merged.

## 3. Verify merged version on fresh `main`

After confirmation, verify the PR is merged with `gh pr view <PR> --json state,mergedAt,mergeCommit`. Require state `MERGED`. Require a clean worktree before switching branches. Switch to `main`, fetch again, fast-forward only, then verify clean state and exact equality with `origin/main`:

```bash
git status --short --branch
git switch main
git fetch --tags origin refs/heads/main:refs/remotes/origin/main
git pull --ff-only origin main
git status --short --branch
git rev-parse HEAD
git rev-parse refs/remotes/origin/main
```

Stop if the checkout is dirty, not on `main`, cannot fast-forward, or `HEAD` differs from `origin/main`. Verify `package.json` now contains the exact PR version; do not make another version edit. Find the prior release tag and compare it with merged `main`:

```bash
prior_tag="$(git describe --tags --abbrev=0 origin/main)"
git log --oneline --decorate "$prior_tag"..origin/main
git diff --stat "$prior_tag"..origin/main
```

Review the commits and relevant diffs. For every issue or PR reference considered for notes, verify the referenced item with `gh issue view <number>` or `gh pr view <number>` (qualify cross-repository references). Exclude unverified, unrelated, or inferred references. Re-read the latest GitHub Release notes with `gh release view "$prior_tag"` and preserve useful style without copying obsolete or unrelated claims.

## 4. Curate notes and publish

Write release notes to a temporary file outside the repository so the clean-worktree check remains satisfied. Use these exact headings, in this order:

```markdown
## Features

## Improvements

## Bug fixes
```

Add concise bullets only for changes verified from commits, diffs, or linked issues. Keep issue/PR links only when they were explicitly referenced and verified. Leave a category without bullets if no verified entry belongs there; never add filler or fabricate a release detail. Do not use generated notes in place of this reviewed content.

Immediately before publishing, reconfirm the merged package version, clean `main`, and equality with `origin/main`. Then run this exact command with the notes file you curated:

```bash
bun run release publish --notes-file <path>
```

For a shell variable, quote its expansion: `bun run release publish --notes-file "$notes_file"`.

The script is the only publishing path. It requires the exact `publish --notes-file <path>` invocation and non-empty notes; checks GitHub CLI authentication, clean `main`, and that `HEAD` matches freshly fetched `origin/main`; refuses an existing `v<package-version>` tag or GitHub Release; builds the binary; creates an annotated tag at the unchanged `HEAD`; pushes that tag ref only; and creates the GitHub Release with the supplied notes and macOS arm64 asset. It never increments `package.json`, commits, or pushes `HEAD`. Do not work around a failed safety check.

If tag creation or push succeeds but GitHub Release creation fails, stop and report the exact state. Do not delete/recreate the tag or blindly rerun the script; resolve the partial publish deliberately.

## 5. Verify and report

After successful publication, verify the unchanged package version and clean `main`, and inspect the remote tag and GitHub Release:

```bash
git status --short --branch
git show -s --format='%H %s' vX.Y.Z
git ls-remote --tags origin refs/tags/vX.Y.Z
gh release view vX.Y.Z
```

Confirm the release entry has the expected tag, curated notes, and `mole-tools-darwin-arm64` asset. Report the version and GitHub Release URL. The GitHub Release is the release entry; the tag and merged version PR are supporting history, not substitutes for it.
