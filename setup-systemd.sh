#!/bin/bash
set -e

SERVICE_FILE="/etc/systemd/system/stellaratlas.service"
WORKDIR="$(pwd)"
USER="$(whoami)"
NODE_BIN="$(dirname $(which node))"
PNPM_BIN="$(which pnpm)"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Stellarbeat All Services
After=network.target

[Service]
Type=simple
WorkingDirectory=$WORKDIR
ExecStart=$PNPM_BIN start:all
Restart=always
RestartSec=5
User=$USER
Environment=NODE_ENV=production
Environment=PATH=$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable stellaratlas
sudo systemctl restart stellaratlas

echo "Systemd service 'stellaratlas' created and started."
