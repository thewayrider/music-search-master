#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "========================================================"
echo " 🛰️  LAUNCHING UNIFIED FLEET COMMAND CENTER (LINUX)"
echo "========================================================"

# Check if server already running on port 4000
if curl -s http://localhost:4000/api/fleet/status >/dev/null 2>&1; then
    echo "[✓] Fleet Server is already running on port 4000."
else
    echo "[1/2] Starting Fleet Server Daemon on port 4000..."
    nohup ./run_node.sh src/server.js > fleet_server.log 2>&1 &
    sleep 2
fi

echo "[2/2] Server operational at http://localhost:4000"
echo "Log output streaming to: fleet_server.log"
echo "========================================================"
