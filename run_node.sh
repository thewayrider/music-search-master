#!/usr/bin/env bash
# Wrapper to always use Node 22 LTS with native node:sqlite
NODE_EXEC="/home/droid/.cache/node-v22/bin/node"
if [ -x "$NODE_EXEC" ]; then
  exec "$NODE_EXEC" "$@"
else
  exec node "$@"
fi
