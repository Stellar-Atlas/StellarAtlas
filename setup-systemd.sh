#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="$REPO_ROOT/ops/systemd"

install_unit() {
	local file_name="$1"
	sudo install -m 0644 "$SYSTEMD_DIR/$file_name" "/etc/systemd/system/$file_name"
}

install_unit stellaratlas.target
install_unit stellaratlas-api.service
install_unit stellaratlas-frontend-v4.service
install_unit stellaratlas-frontend-v4-staging.service
install_unit stellaratlas-frontend-legacy.service
install_unit stellaratlas-network-scanner.service
install_unit stellaratlas-users.service
install_unit stellaratlas-history-scanner@.service

sudo install -m 0644 \
	"$SYSTEMD_DIR/10-stellaratlas-observe.rules" \
	/etc/polkit-1/rules.d/10-stellaratlas-observe.rules

sudo systemctl daemon-reload
sudo systemctl disable --now stellaratlas.service 2>/dev/null || true
sudo systemctl mask stellaratlas.service 2>/dev/null || true
sudo systemctl enable --now stellaratlas.target

cat <<'EOF'
Installed split StellarAtlas services.

Production:
  systemctl status stellaratlas.target
  systemctl restart stellaratlas-frontend-v4.service

Staging frontend:
  pnpm build:frontend-v4:staging
  systemctl start stellaratlas-frontend-v4-staging.service
  systemctl status stellaratlas-frontend-v4-staging.service
EOF
