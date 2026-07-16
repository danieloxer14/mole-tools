#!/bin/sh
printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"assistant response"}]}}'
printf '%s\n' '{"type":"usage","usage":{"inputTokens":123,"outputTokens":45,"cacheReadTokens":7,"cacheWriteTokens":9,"cost":0.0123}}'
