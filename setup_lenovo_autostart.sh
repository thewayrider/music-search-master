#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/music-search-fleet.service"

mkdir -p "$UNIT_DIR"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Music Search Master - Unified Fleet Command Center & Catch-Up Scheduler
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/env bash $PROJECT_DIR/run_node.sh src/server.js
Restart=on-failure
RestartSec=15
Environment=NODE_ENV=production
StandardOutput=append:$PROJECT_DIR/fleet_server.log
StandardError=append:$PROJECT_DIR/fleet_server.log

[Install]
WantedBy=default.target
EOF

chmod +x "$PROJECT_DIR/run_node.sh" "$0"
systemctl --user daemon-reload
systemctl --user enable music-search-fleet.service
systemctl --user restart music-search-fleet.service

echo "[+] Installed and started systemd user service: $UNIT_FILE"
systemctl --user --no-pager status music-search-fleet.service || true
