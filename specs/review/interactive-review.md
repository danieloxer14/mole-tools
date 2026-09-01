# Interactive review specification

**Status:** Implemented
**Command:** `mole-tools review <gitlab-mr-url>`

Interactive review puts a GitLab merge request's local diff, a generated review
guide, and a session-persistent agent in one loopback-only web UI. The CLI owns
repository/worktree setup and the server lifetime. GitLab supplies merge-request
metadata, diff refs, and discussions; local git supplies the diff shown in the
centre column.

## 1. Invocation and configuration

The command accepts a full GitLab URL containing
`/-/merge_requests/<iid>`:

```text
mole-tools review <mr-url> [--mode code|plan] [--no-open] [--refresh]
```

| Flag | Contract |
|---|---|
| `--mode code\|plan` | Selects the review lens. `code` is the default. The only mode difference is the layer prompt: `review-layers-code` or `review-layers-plan`. |
| `--no-open` | Prints the local URL but does not ask the operating system to open a browser. |
| `--refresh` | Re-fetches the MR head and rebuilds the detached worktree/diff before opening the server. Without it, an existing review remains anchored to its persisted revision. |

The feature requires an authenticated `glab` and the configured review agent
binary on `PATH`. The optional top-level `review` config is independent of
`models`/`RoutingPurpose`:

```jsonc
{
  "review": {
    "agent": "omp",                 // "omp" or "claude"
    "binary": "omp",                // optional binary override
    "model": "review-model",        // optional OMP model
    "layerTimeoutSeconds": 600,
    "largeFileLineThreshold": 800
  }
}
```

Prompt overrides use the existing prompt-loader convention. The first read
seeds these files under `~/.config/mole-tools/prompts/` without overwriting user
edits:

- `review-layers-code.md`
- `review-layers-plan.md`
- `review-chat.md`

## 2. Repository and worktree lifecycle

1. Parse the URL into GitLab host, project path, and numeric MR IID.
2. Fetch MR metadata and its `diff_refs` through the existing `GitHost` port and
   `GlabAdapter`, always passing the URL host to `glab api`.
3. Prefer the current working directory when its `origin` matches the MR
   project. Otherwise reuse the cache clone at
   `~/.config/mole-tools/repos/<host>/<projectPath>/`; if absent, clone the MR
   project's HTTPS remote there.
4. Fetch the MR head SHA, compute `merge-base(targetBranch, headSha)`, and create
   a detached worktree at
   `~/.config/mole-tools/worktrees/<host>/<projectPath>/mr-<iid>/`.
5. Compute the local diff from merge base to head. `diff.ignore` entries remain
   in the changed-file/stat view but their patch is removed until explicitly
   expanded.
6. Persist review state before serving the page.

The worktree is review input, not a checkout to edit. Chat and comment agents
are read-only, and layer output is written outside it. The CLI does **not**
automatically remove the detached worktree when the server stops. Use
`mole-tools worktree-prune` or remove a known stale worktree deliberately after
checking its path. The server runs only while the CLI is paused; pressing Enter
stops the server but leaves repository cache, worktree, review state, transcript,
and generated layer output on disk for the next run.

## 3. Local server and request token

The server binds to `127.0.0.1` on an ephemeral port and mints a random token
for each CLI run. Startup prints a URL in this form:

```text
http://127.0.0.1:<port>/?t=<random-token>
```

The token is not persisted. Every `/api/*` request must carry it either as the
`t` query parameter or the `X-Mole-Token` header; missing/incorrect tokens get
`401` with an empty body. The bundled HTML page at `/` is not API-authenticated.
This is a local single-user server, not a remote or background service.

Stream responses use `Content-Type: text/event-stream; charset=utf-8`. Chat
requests send JSON bodies with `Content-Type: application/json` and
`Accept: text/event-stream`; layer and comment stream requests send
`Accept: text/event-stream` without a request `Content-Type`. The UI does not
use `EventSource` because chat and draft requests have JSON bodies. Each stream
emits `event:`/`data:` frames and closes with `done`, including when an agent or
subprocess fails.

Implemented HTTP surface:

| Method + path | Contract |
|---|---|
| `GET /` | Serve embedded React HTML. |
| `GET /api/state` | Return persisted state plus parsed filtered diff, discussions, live approval status, and large-file threshold. A pending layer guide starts its first run here. |
| `GET /api/approval` | Return live GitLab approval status for the current user and merge request. |
| `POST /api/approval` | Accept `{ action: "approve" | "unapprove" }` and mutate the current user's GitLab approval. |
| `GET`/`POST /api/refresh` | Re-fetch the MR head and report `{ stale, headSha, newCommitCount }`; this check does not mutate the worktree. |
| `POST /api/sync` | Explicitly fetch the new head, re-point the detached worktree, recompute merge base/diff/refs, mark layers stale, and flag drafts whose anchors no longer resolve. |
| `POST /api/progress` | Persist a layer `done` toggle and/or a viewed-file change. |
| `GET /api/file?path=&side=` | Return text from the worktree (`new`) or the merge-base revision (`old`); reject traversal outside the worktree. |
| `GET /api/diff?path=` | Return the unfiltered parsed file diff for an explicit expansion. |
| `POST /api/layers/regenerate` or `/api/layers/retry` | Run layer generation and stream status/done frames. |
| `GET /api/chat?chatId=` | Return entries for the selected chat. |
| `POST /api/chat` | Accept `{ chatId, message, tags[], openFile }` and stream text/tool/error frames. |
| `POST /api/chat/cancel` | Accept `{ chatId }`, abort that chat's active turn, and return `204`. |
| `POST /api/chats` | Create and activate a chat; return `201` with `{ chats, activeChatId }`. |
| `POST /api/chats/active` | Accept `{ chatId }`, persist the selection, and return `204` (`404` for an unknown chat). |
| `POST /api/comments/draft` | Accept `{ selection, filePath }`; persist and return an empty local draft. |
| `PUT /api/comments/:id` | Edit a local draft body. Posted comments return a conflict and cannot be edited. |
| `DELETE /api/comments/:id` | Cancel/remove a local draft. |
| `POST /api/comments/:id/send` | Validate the anchor, post one GitLab discussion, refetch discussions, retain the local draft as `status: "posted"` with `postedDiscussionId`, and render the refreshed discussion in the read-only posted thread. |

## 4. Three-column UI and diff contract

The page has three working columns:

- **Left — Review layers.** MR title, an Open in GitLab link, live approval
  status with Approve/Remove approval actions, layer status, Regenerate/Retry,
  manual Done checkboxes, per-layer file chips, per-layer file coverage, and a
  global Viewed-files progress bar.
- **Centre — Changed files and diff.** The complete changed-file tree remains
  available even when a layer does not mention a file. Each row shows insertion
  and deletion counts plus a persisted Viewed checkbox. Selecting a file opens
  its diff.
- **Right — Agent chat.** General discussions, restored transcript, streaming
  response/tool activity, line-context tags, composer, New chat button, chat
  switcher, and Stop.

The centre column supports Inline and Side by side layouts. Shiki highlights
source lines. Added lines use the new side, deleted lines use the old side, and
line numbers are retained for both sides. Binary files show a stat line only.
A file with no patch (including a stat-only ignored file), or with more than
`largeFileLineThreshold` diff lines (default `800`), starts collapsed with an
Expand diff control. Modified text-file diffs also expose `Whole file` and
`Diff only` controls. The existing single table fills head, inter-hunk, and tail
gaps from fetched file contents: head/tail rows reveal 20 lines at a time and
offer `Expand all`; inter-hunk rows keep their Expand/Hide behavior. Revealed
context has both old/new line numbers, uses the same highlighting as hunk rows,
and offers local `Tag line` only—never a GitLab `Comment`. `Whole file` is kept
per file for the browser session, confirms files over the configured total-line
threshold, and `Diff only` returns the nearest visible hunk to the viewport.

Existing GitLab discussions are read-only. Positioned discussions appear below
their matching diff lines with resolved/unresolved styling and all notes;
unpositioned discussions appear in the chat column as General discussions.

## 5. Layered review guide

The first page load automatically starts generation when `layerStatus` is
`pending`. A cached `ready` guide is reused on later opens. Regenerate always
starts a new run; Retry is available after a failed run. The diff and chat stay
usable while a guide is running or failed.

Layer input contains:

- MR metadata, source/target branches, head/merge-base SHAs, and GitLab diff refs;
- commits between merge base and head;
- filtered file stats, changed-file paths, and the filtered unified diff;
- existing GitLab discussions; and
- a Jira issue when Jira is enabled and its configured branch/title pattern
  finds a key.

The agent writes a JSON document to the supplied absolute output path. The
validated document is version `1` and has one or more layers, each with:

```json
{
  "version": 1,
  "layers": [
    {
      "title": "Short review concern or change area",
      "tldr": "One-paragraph explanation",
      "files": ["src/example.ts"],
      "bdd": ["Given ... When ... Then ..."]
    }
  ]
}
```

`files` is curated over the full changed-file tree; unknown paths are dropped,
and an empty layer is dropped. Prompts guide the agent to cover what changed,
architecture/implementation layers, implied decisions, and verification. BDD
sentences are guidance for verification layers, not a required fixed section.
The plan prompt additionally examines requirements completeness, assumptions,
risks, and acceptance-criteria testability.

Layer output is written under
`~/.config/mole-tools/reviews/<host>/<projectPath>/mr-<iid>/layers/`. Missing or
invalid JSON gets one retry with the validation error; a second failure stores
`layerStatus: "failed"` and shows the error plus Retry. Layer runs respect
`review.layerTimeoutSeconds` (default `600`).

Progress is explicit: a reviewer marks each layer Done, marks individual files
Viewed, and can use each layer's file chips to navigate the centre column. A
layer's file-coverage bar counts only its curated files; the global bar counts
all changed files.

## 6. Chat, tagging, and agent safety

Chat uses configured `ReviewAgent` with read-only worktree policy. OMP is
allowlisted to `read,grep,glob,bash`; Claude is allowlisted to
`Read,Grep,Glob,Bash`. The agent can inspect additional files itself but
receives no write tool for chat turn. Bash is limited by prompt policy to
read-only inspection commands. Prompt also explicitly instructs it to refuse
edits. Review worktree must remain byte-identical after chat.

Turn construction is intentionally asymmetric:

- Turn one of every chat includes MR metadata, the current layer guide, and the
  changed-file list in its system-prompt file.
- Later turns include only the new message, newly selected tags, and currently
  open file; the resumed provider session retains the initial context.
- The user message is rejected when blank. Tags are validated objects carrying
  `path`, `side`, inclusive `startLine`/`endLine`, and the hunk header.
- Prompt files are stored under the review's `prompt/` directory. User and
  assistant entries are appended to that chat's `chats/<chatId>.ndjson`;
  each chat owns its provider session id, stored in state and on each
  transcript entry.

Tag line adds one line to agent-chat context. Shift-selecting two lines in the
same hunk creates an inclusive context range. Dragging from a line's Tag line
button to another line in the same hunk on the same side adds that inclusive
range as one tag in a single gesture; the drag is clamped to the origin hunk
and the origin side, Esc aborts the drag with no tag added, and releasing the
mouse outside the diff panel commits the last clamped range. Revealed
inter-hunk context lines have no hunk to clamp to, so they keep tagging one
line at a time via their own click and are never part of a drag. Dragging
from a rendered-Markdown block's Tag button across later blocks adds one tag
spanning those blocks' source lines, snapping to block boundaries. Tags can
be removed before sending, or cleared all at once. The UI streams text and
tool start/end activity, keeps partial assistant text on failure/cancel, and
enables the next turn after Stop. At most one turn runs per chat; different
chats can run in parallel. Switching chats never interrupts a running turn,
and chats cannot be deleted.

**Reload limitation:** A page reload drops the browser-side stream readers. The
server turn keeps running, still appends the assistant entry, and
`GET /api/state` reports the chat as busy, but text streamed during the reload
is not replayed; it appears once the transcript is refetched.

## 7. Positioned comment lifecycle

A reviewer can add a comment from a line, an inclusive same-side selection, a
drag from a line's Comment button to another line in the same hunk on the
same side, or a tagged line. A comment drag is clamped to one hunk so it can
always build a valid GitLab position. Creating a comment immediately opens an
empty local draft editor below the selection's last line. The user writes its
body; no agent turn or comment-generation prompt runs. The draft is local until
its own Send: there is no batch submit. Draft statuses are `draft`, `sending`,
`posted`, and `failed`; Cancel removes it, Edit persists body changes, and
failed drafts keep their error with Retry. While sending, the draft is persisted
before `GitHost.createDiscussion`; the UI shows `Sending…`, disables Edit and
Send, and keeps Cancel available. A post failure transitions the draft to
`failed` with its error.

Before Send, mole-tools validates the selection against the parsed diff and
current `diff_refs`:

- `side: "new"` anchors `new_line`; `side: "old"` anchors `old_line` (needed
  for deleted lines).
- `old_path` and `new_path` come from the parsed file.
- A multi-line range emits GitLab's `line_range` on one side only. Both endpoints
  must exist in the same diff hunk and the anchor is the range's end line.
- Cross-side ranges, reversed ranges, missing hunk lines, stale refs, and paths
  that do not match the selected side are rejected before the API call.

A successful Send posts one `GitLabPositionPayload` through `GitHost` using
`glab api --method POST --input -`, refetches discussions, and retains the
local draft as `status: "posted"` with `postedDiscussionId` while the refreshed
discussion renders in the read-only posted thread. Posted comments are not
editable in this UI. A post failure keeps the draft and inline error.

## 8. Plan mode and markdown rendering

`--mode plan` uses the plan-oriented layer prompt and otherwise runs the same
repository, diff, chat, comments, persistence, and sync flow as `--mode code`.
Changing mode for an existing review invalidates its cached layers so the new
prompt runs; it does not create a second worktree or review store.

Files ending in `.md` or `.mdx` have a Rendered/Diff toggle. Added markdown
defaults to Rendered; modified markdown defaults to Diff. Rendered mode reads
file contents from the worktree, parses GitHub-flavoured Markdown, sanitizes the
HTML, and highlights fenced code. Fenced `mermaid` blocks render with the
bundled Mermaid runtime using strict security. If Mermaid or Markdown rendering
fails, the UI displays the error and source instead of a blank pane. Diff mode
always remains available.

## 9. Persistence and synchronization

All paths are rooted at the directory containing the configured config file
(`~/.config/mole-tools/` by default):

```text
repos/<host>/<projectPath>/                         cache clone
worktrees/<host>/<projectPath>/mr-<iid>/            detached worktree
reviews/<host>/<projectPath>/mr-<iid>/review.json   zod-validated state
reviews/<host>/<projectPath>/mr-<iid>/chats/<chatId>.ndjson per-chat transcript
reviews/<host>/<projectPath>/mr-<iid>/chat.ndjson      one-time adoption source
reviews/<host>/<projectPath>/mr-<iid>/layers/<run>.json
```

`review.json` is written through a temp file followed by atomic rename and a
serialized write queue. Each `chats/<chatId>.ndjson` stores one JSON object per
user or assistant entry: `{ role, text, tags, at, sessionId }`. State includes
MR identity, mode, revision/diff refs, repo/worktree paths, layer status and
guide, viewed files, `chats`, `activeChatId`, and comment drafts. The legacy
`chatSessionId` field is read-only and retained only for reading pre-multi-chat
v1 files. The legacy `chat.ndjson` file is adopted once into the per-chat
directory. State and transcript are validated when read. A state version
mismatch discards the old v1 file and starts fresh; there is no schema migration.

Freshness is detected, never silently applied:

1. Refresh asks GitLab for current MR metadata, fetches the head ref, compares it
   with persisted `revision.headSha`, and reports whether it is stale plus the
   number of new commits when locally comparable.
2. The UI shows a banner and offers Sync. It does not mutate the worktree during
   this check.
3. Explicit Sync fetches the new head, computes a new merge base, removes and
   recreates the detached worktree at that SHA, recomputes local filtered and
   full diffs, and stores new `diff_refs`/`syncedAt`.
4. Sync marks every existing layer `stale: true`. It keeps chat, viewed-file
   progress, and drafts. A draft whose selected path/lines no longer build a
   valid position receives `staleSince`; it is not auto-posted.
5. The UI may regenerate layers after Sync, but never forces regeneration. The
   reviewer must explicitly choose it.

## 10. Failure and non-goals

Once the server is up, agent, GitLab discussion, file, sync, and layer failures
are returned as UI-visible errors with retry where applicable. A failed layer
does not hide the diff or chat; a failed discussion post preserves its draft;
a stale anchor is rejected before posting. API responses are `no-store`.

This feature does not provide remote access, a background daemon, automatic
worktree cleanup, batch review submission, discussion editing/resolution after
posting, merges, or hosts other than GitLab.
