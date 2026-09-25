# ADR 0007: Review skills

- **Status:** Accepted
- **Date:** 2026-09-25
- **Scope:** User-authored skills in review settings and chat

## Context

Issue #55 asks for manually invoked, user-authored prompt snippets (“skills”)
that users can create and version in review Settings, then insert into chat by
name. A selected skill must appear in the draft as a tag, use its active text
when sent, and remain recognizable as that tag in the transcript. The browser
must not read or write the local skill files directly.

The design must preserve normal textarea editing and chat behavior, use the
latest active skill text at send time, and keep enough information in each
transcript entry to render the original tags after a skill changes.

## Decision

### D13 — Inline skill tokens in a textarea

A skill is referenced in the composer as `/<name>`. The textarea remains the
source of truth for the draft; a mirrored backdrop highlights recognized tokens
without replacing the input with editable chips. Selecting a skill inserts its
token and a trailing space unless the following character is already
whitespace. Backspace or Delete at a token removes the complete token.

Keeping a plain textarea avoids the caret, paste, and IME complexity of a
`contenteditable` composer, while preserving the existing draft string and
Enter-key policy.

### D14 — Expand skills on the server

The client sends the raw draft unchanged. The server synchronously reserves a
chat before awaiting skill reads, rejecting duplicate turns for that chat while
allowing different chats to proceed concurrently. It reads only names from
syntactic slash-token candidates and replaces known tokens with each skill's
current active text. Unknown names remain literal, and candidate-free messages
read no skill data. If expansion leaves the message blank, the server returns
`Chat message must not be empty`, releases the reservation, and persists no
turn. The chat title is derived from the raw draft, not the expanded text.

### D15 — Persist exact skill invocations with expansion references

A persisted user chat entry stores the expanded `text`, raw `sourceText`, the
exact matched `skillInvocations` ranges (`name`, `start` at `/`, and exclusive
`end`), and a `skills` array of distinct references containing each used
skill's name, version, and exact text. New entries render from their source
draft and recorded ranges rather than reverse-matching expanded text.
Persisted entries never consult the current skill catalog. This preserves
tokens for empty or identical skill text and prevents literal text equal to a
skill body from being tagged by mistake.

Legacy NDJSON entries without invocation data remain readable. Their
best-effort display may use saved skill references only, never skills created
later. Assistant entries are unchanged.

### D16 — Store skills separately with atomic, serialized mutations

Skills live under `~/.config/mole-tools/skills/<name>/`. Each skill directory
contains `skill.json` for its active-version and last-used metadata and
canonical generated `.md` filenames for positive safe-integer versions. File
writes use a temporary file followed by rename; version text is written before
metadata that selects it. Mutations use a per-instance queue so concurrent
writes do not lose updates.

A dedicated skills directory keeps deletion self-contained and avoids
rewriting `config.json`, which can discard comments. Serializing mutations
protects active-version and most-recently-used metadata from lost updates.

### D17 — Inject the skill store into review routes

Review routes accept an optional `SkillStore`. The review feature injects a
store for the configured skills directory. When no store is supplied,
`/api/skills*` routes return `503` with `Skills are unavailable`, and chat does
not expand skill tokens. Optional injection keeps route tests isolated from a
user's home directory and preserves behavior for routes without skill support.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Replace the textarea with `contenteditable` chips | Caret movement, paste, and IME behavior are fragile; a mirrored backdrop highlights tokens without replacing the existing string-based composer. |
| Expand tokens in the client | The browser could send stale text instead of the server's current active version; server expansion also owns turn registration and skill-use tracking. |
| Store active versions in an active-version map in `config.json` | Skills have version and last-used metadata of their own; rewriting `config.json` can discard comments, while a self-contained skill directory makes deletion and persistence independent. |

## Consequences

- Users edit and version skills in review Settings and invoke them explicitly
  from the composer; skills do not auto-activate or accept parameters.
- The model receives expanded skill text, while user transcripts retain the
  corresponding skill tags across later edits and reloads.
- Skill state is stored separately from `config.json`; API routes own browser
  access and remain unavailable when no store is injected.

### Composer discovery and Settings entry

The composer placeholder tells users to type `/` to open the skills menu. The
slash-triggered popover appears above the slash; when filtering returns no
matches, it shows **No matches** and a plus button that opens Settings directly
on the Skills tab. The Skills tab keeps its **New skill** button pinned above
the scrollable skill list, and the cancellable create dialog validates names
inline before enabling Create.

This keeps skill discovery in the message composer and provides a direct
recovery path when no existing skill matches, without a permanent button beside
Send.
