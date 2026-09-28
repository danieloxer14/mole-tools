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
- Treat the merged catalog entry as the sole source of GitHub Release notes. Preserve its wording verbatim and use the required headings; do not independently curate notes or add styling, PR context, or other claims.

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

Require a clean worktree on `main` whose `HEAD` equals `origin/main`. If any check fails, stop and report the exact state; do not switch away from uncommitted work, reset, or guess which changes to discard. Inspect `package.json`'s current version and the root `releases.json` catalog. Validate that the catalog is a non-empty newest-first JSON array; each entry has exactly `version`, `description`, `features`, `improvements`, and `fixes`; versions are unique strict `MAJOR.MINOR.PATCH`; descriptions and every list item are non-empty plain text with no Markdown or HTML markup; category values are arrays of strings (which may be empty); and versions are strictly descending. Require the first catalog version to equal `package.json`'s version and the latest GitHub Release/tag version. If the latest release and tag disagree, stop before choosing a bump.
Run the catalog and version checks with Bun from the repository root. Example validator:

```bash
LATEST_TAG="$latest_tag" bun -e '
const fs = require("node:fs");
const catalog = JSON.parse(fs.readFileSync("releases.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const keys = ["version", "description", "features", "improvements", "fixes"];
const versionPattern = /^\d+\.\d+\.\d+$/;
const parseVersion = (value) => {
  if (typeof value !== "string" || !versionPattern.test(value)) throw Error(`invalid version: ${value}`);
  return value.split(".").map(BigInt);
};
const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
};
const markupPattern = /<\s*\/?[A-Za-z][^>]*>|<!--|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);|!?\[[^\]\n]*\]\([^)\n]*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|!\[[^\]\n]*\]|(?:^|\n)\s{0,3}\[[^\]\n]+\]:|`{1,3}[^`\n]+`|(?:\*\*|__|~~)[^\n]+?(?:\*\*|__|~~)|(?:^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s)|(?:^|\s)(?:\*[^*\n]+\*|_[^_\n]+_)(?:\s|$)/i;
const nonEmptyPlainText = (value) => typeof value === "string" && value.length > 0 && value === value.trim() && !markupPattern.test(value);
if (!Array.isArray(catalog) || catalog.length === 0) throw Error("catalog must be a non-empty array");
const seen = new Set();
let previous;
for (const entry of catalog) {
  if (!entry || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== [...keys].sort().join(",")) throw Error("invalid catalog entry keys");
  const parsed = parseVersion(entry.version);
  if (seen.has(entry.version)) throw Error(`duplicate version: ${entry.version}`);
  seen.add(entry.version);
  if (previous && compare(parsed, previous) >= 0) throw Error("catalog must be strictly newest-first");
  previous = parsed;
  if (!nonEmptyPlainText(entry.description)) throw Error("description must be non-empty plain text without Markdown or HTML");
  for (const field of keys.slice(2)) {
    if (!Array.isArray(entry[field]) || entry[field].some((item) => !nonEmptyPlainText(item))) throw Error(`${field} must contain only non-empty plain text without Markdown or HTML`);
  }
}
if (catalog[0].version !== pkg.version) throw Error("catalog top version must equal package.json version");
const latestTag = process.env.LATEST_TAG?.replace(/^v/, "");
if (!latestTag || catalog[0].version !== latestTag) throw Error("catalog top version must equal latest published tag");
'
```
Set `LATEST_TAG` to the tag verified above when running that validator. Also confirm `gh release view "$latest_tag" --json tagName --jq .tagName` identifies that same latest release; the catalog top version, package version, latest tag, and latest GitHub Release must all agree. Stop if any disagree.

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

Use a new branch based on fetched `origin/main`, named `release/vX.Y.Z`. If that branch already exists, inspect it and its PR; do not overwrite or force-push it. Update `package.json`'s `version` and prepend one entry for the target version to `releases.json`. The catalog entry must have exactly `version`, `description`, `features`, `improvements`, and `fixes`; use a concise factual, non-empty plain-text description and non-empty plain-text strings in categorized arrays. Empty arrays are allowed. Base every note on verified commits, diffs, and linked issues/PRs. Preserve strict newest-first order, unique strict `MAJOR.MINOR.PATCH` versions, and the existing schema. Do not change lockfiles, create a tag, or publish from the release branch.

Review `git diff -- package.json releases.json` and `git status --short`; confirm the only changed files are exactly `package.json` and `releases.json`, and that only the package version and new catalog entry changed. Run the catalog/version validation above, plus the focused catalog test and standard quality gates required by the repository. Commit and push only those two files, then open a PR to `main` with `gh`:

```bash
git switch -c release/vX.Y.Z origin/main
git add package.json releases.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z --title "chore(release): vX.Y.Z" --body "Bump package version and add release catalog entry for vX.Y.Z."
gh pr view release/vX.Y.Z
```

Report the PR URL, exact version, and why the bump fits. **Pause here.** Ask the user to review, approve, and merge the PR. Do not approve or merge it, run post-merge commands, or publish until the user explicitly confirms the PR is merged.

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

Stop if the checkout is dirty, not on `main`, cannot fast-forward, or `HEAD` differs from `origin/main`. Verify `package.json` and the first `releases.json` entry both contain the exact approved PR version; rerun the catalog schema/order validation and confirm package/catalog version agreement. The latest published tag and GitHub Release should still match the preceding catalog entry until this version is published; do not require them to match the new catalog top before publishing. Do not make another version or catalog edit. Find the prior release tag and compare it with merged `main`:

```bash
prior_tag="$(git describe --tags --abbrev=0 origin/main)"
git log --oneline --decorate "$prior_tag"..origin/main
git diff --stat "$prior_tag"..origin/main
```

Review the commits and relevant diffs to understand and verify the merged catalog entry. The entry at `releases.json` index 0 is the sole source of the GitHub Release notes; do not independently recurate or add claims. For any issue or PR reference included in that entry, verify it with `gh issue view <number>` or `gh pr view <number>` (qualify cross-repository references). If an entry contains an unverified or unrelated reference or claim, stop and report it rather than silently publishing divergent notes.

Create a temporary notes file outside the repository, using the merged entry's description followed by non-empty categories only, in this exact order and heading style:

```markdown
<description from the merged catalog entry>

## Features

- <each feature, verbatim from the merged catalog>

## Improvements

- <each improvement, verbatim from the merged catalog>

## Bug fixes

- <each fix, verbatim from the merged catalog>
```

Omit any category section whose array is empty. Preserve catalog wording exactly; do not add generated notes, separate curation, or unsupported references. Keep the notes file outside the repository so the clean-worktree check remains satisfied.

Immediately before publishing, reconfirm the merged package version, catalog top version, clean `main`, and equality with `origin/main`. Then run this exact command with the derived notes file:
```bash
bun run release publish --notes-file <path>
```

For a shell variable, quote its expansion: `bun run release publish --notes-file "$notes_file"`.

The script is the only publishing path. It requires the exact `publish --notes-file <path>` invocation and non-empty notes; checks GitHub CLI authentication, clean `main`, and that `HEAD` matches freshly fetched `origin/main`; refuses an existing `v<package-version>` tag or GitHub Release; builds the binary; creates an annotated tag at the unchanged `HEAD`; pushes that tag ref only; and creates the GitHub Release with the supplied notes and macOS arm64 asset. It never increments `package.json`, changes `releases.json`, commits, or pushes `HEAD`. Do not work around a failed safety check.

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
