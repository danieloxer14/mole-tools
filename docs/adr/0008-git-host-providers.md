# ADR 0008: Git host providers for review and merge requests

- **Status:** Accepted
- **Date:** 2026-10-09
- **Scope:** `mole-tools review` and `mole-tools merge-request`

## Context

Issue [#78](https://github.com/danieloxer14/mole-tools/issues/78) requests GitHub support in addition to the existing GitLab integration. Review and merge-request operations use host-specific APIs and authentication, while cloning, fetching commits, detached worktrees, and diff operations remain ordinary git operations.

The existing host port represented GitLab operations and position payloads directly. GitHub can support the interactive review and merge-request workflows, but review-babysitter depends on GitLab-only instance discovery, merge status, approval rules, labels, and pipelines. Host selection also differs by workflow: review has an explicit URL, while merge-request runs in a checkout with an `origin` remote.

## Decision

Introduce a provider-neutral `GitHost` for common request and discussion operations, with `GitLabAutomationHost` extending it for babysitter-only capabilities. Positioned discussion input carries a provider-neutral line `selection`; each adapter constructs its native payload.

Review URL parsing returns the provider alongside its merge-request reference. `MrDetail` records provider identity, which is persisted in review state with a `gitlab` default for older state. The review URL selects the provider and host. `merge-request` detects `github.com` in `origin` and uses GitHub; other or unreadable origins use GitLab. GitHub Enterprise URLs can be used for review, but GitHub Enterprise `merge-request` detection is unsupported.

Composition exposes `gitHostFor(target)` and a separate `gitLabAutomation` service. GitLab remains the default adapter; `GhAdapter` instances are cached per normalized host. The GitHub adapter uses the `gh` CLI through an injectable executor, matching the `glab` adapter pattern. Paginated GitHub API requests use `--paginate --slurp` and do not combine those flags with `--jq`.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Keep one fat `GitHost` and make GitHub throw for babysitter operations | Unsupported stubs would obscure the babysitter's GitLab-only contract; a typed `GitLabAutomationHost` split makes that dependency explicit. |
| Keep `GitLabPositionPayload` in the port and reverse-map it in GitHub | The shared port would remain coupled to GitLab; neutral line selection lets each adapter construct its own payload. |
| Add provider identity to `MrRef` | Provider identity is needed for host selection and UI state, not every reference; `parseReviewUrl` returns it separately and persisted state defaults legacy records to GitLab. |
| Keep one mutable `ctx.gitHost` | A process can need GitHub review and GitLab babysitter simultaneously; `gitHostFor(target)` plus `gitLabAutomation` keeps both available and caches GitHub adapters per host. |
| Use direct HTTP requests and tokens for GitHub | `gh` CLI shares the GitLab CLI authentication model and injectable-executor test seam. |

## Consequences

- `review` supports GitLab merge requests and GitHub pull requests. GitLab continues to use `glab`; GitHub uses `gh` authenticated for the review URL host.
- `merge-request` selects GitHub only for `github.com` origins. GitHub Enterprise and other non-`github.com` origins use the GitLab path through `glab`.
- Review-babysitter remains GitLab-only; its GitLab-specific operations do not become unsupported stubs on `GitHost`.
- GitHub description images are not proxied; private images may not render in the local review UI.
- Review threads expose at most 100 comments per thread.
- Unapprove dismisses the user's approving review and may require repository permission. Host errors are surfaced.
- GitHub may reject LEFT-side comments on renamed files; failed sends leave the draft marked failed.
- GitLab and GitHub positioned comments use one shared selection contract, while adapters retain responsibility for vendor-specific position payloads.
- Existing review state without provider identity continues to load as GitLab.
