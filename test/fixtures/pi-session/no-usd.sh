#!/bin/sh
set -eu
session_dir=""; prev=""
for arg in "$@"; do [ "$prev" = "--session-dir" ] && session_dir="$arg"; prev="$arg"; done
printf '%s\n' '{"type":"session","id":"session-no-usd"}' > "$session_dir/session.jsonl"
printf '%s\n' '{"type":"session","id":"session-no-usd"}' '{"type":"message_end","message":{"role":"assistant","usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":10,"cacheWriteTokens":2}}}' >> "$session_dir/session.jsonl"
printf '%s\n' '{"type":"session","id":"session-no-usd"}'
