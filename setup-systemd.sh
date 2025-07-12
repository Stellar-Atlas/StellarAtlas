#!/bin/bash
set -e

SERVICE_FILE="/etc/systemd/system/stellaratlas.service"
WORKDIR="$(pwd)"
USER="$(whoami)"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Stellarbeat All Services
After=network.target

[Service]
Type=simple
WorkingDirectory=$WORKDIR
ExecStart=pnpm start:all
Restart=always
RestartSec=5
User=$USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable stellaratlas
sudo systemctl restart stellaratlas

echo "Systemd service 'stellaratlas' created and started."
