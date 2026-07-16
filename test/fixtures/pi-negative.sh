#!/bin/sh
printf '%s\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"response"}]}}'
printf '%s\n' '{"type":"usage","input_tokens":-10,"output_tokens":2.9,"cache_read_input_tokens":-5,"cache_write_input_tokens":4,"cost_usd":0.25}'
