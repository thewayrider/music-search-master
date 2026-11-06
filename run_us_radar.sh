#!/usr/bin/env bash
cd "$(dirname "$0")"
./run_node.sh src/index.js --radar-us "$@"
