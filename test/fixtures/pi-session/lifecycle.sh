#!/bin/sh
set -eu
trap 'exit 130' TERM INT
session_dir=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--session-dir" ]; then session_dir="$arg"; fi
  prev="$arg"
done
: "${session_dir:?missing session dir}"
if [ -n "${PI_SESSION_MARKER:-}" ]; then printf '%s' "$session_dir" > "$PI_SESSION_MARKER"; fi
id="session-lifecycle"
printf '%s\n' "{\"type\":\"session\",\"id\":\"$id\"}" 
case "${PI_SESSION_MODE:-success}" in
  failure) exit 9 ;;
  malformed) printf '%s\n' 'not json' > "$session_dir/session.jsonl"; printf '%s\n' "{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"output\"}]}}"; exit 0 ;;
  cancel) sleep 30 ;;
  *)
    printf '%s\n' "{\"type\":\"session\",\"id\":\"$id\"}" "{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"output\"}],\"usage\":{\"inputTokens\":3,\"outputTokens\":2,\"cacheReadTokens\":1,\"cacheWriteTokens\":0,\"cost\":{\"total\":0.001}}}}" > "$session_dir/session.jsonl"
    printf '%s\n' "{\"type\":\"tool_execution_start\",\"toolCallId\":\"tool-1\",\"toolName\":\"bash\",\"args\":{}}" "{\"type\":\"tool_execution_end\",\"toolCallId\":\"tool-1\",\"toolName\":\"bash\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"full tool output\"}]},\"isError\":false}" "{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"output\"}]}}"
    ;;
esac
