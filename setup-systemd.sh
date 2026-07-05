#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="$REPO_ROOT/ops/systemd"

link_unit() {
	local file_name="$1"
	local source="$SYSTEMD_DIR/$file_name"
	local target="/etc/systemd/system/$file_name"

	sudo ln -sfnT "$source" "$target"
}

link_unit stellaratlas.target
link_unit stellaratlas-api.service
link_unit stellaratlas-frontend-v4.service
link_unit stellaratlas-frontend-v4-staging.service
link_unit stellaratlas-frontend-legacy.service
link_unit stellaratlas-network-scanner.service
link_unit stellaratlas-scp-live-scanner.service
link_unit stellaratlas-users.service
link_unit stellaratlas-history-scanner@.service

sudo install -m 0644 \
	"$SYSTEMD_DIR/10-stellaratlas-observe.rules" \
	/etc/polkit-1/rules.d/10-stellaratlas-observe.rules

sudo systemctl daemon-reload
sudo systemctl disable --now stellaratlas.service 2>/dev/null || true
sudo systemctl mask stellaratlas.service 2>/dev/null || true
sudo systemctl enable --now stellaratlas.target
sudo systemctl enable --now stellaratlas-scp-live-scanner.service

cat <<'EOF'
Linked split StellarAtlas services to repo unit templates.

Production:
  systemctl status stellaratlas.target
  systemctl restart stellaratlas-api.service
  systemctl restart stellaratlas-frontend-v4.service
  systemctl restart stellaratlas-scp-live-scanner.service
  systemctl restart stellaratlas-history-scanner@1.service

Staging frontend:
  pnpm build:frontend-v4:staging
  systemctl start stellaratlas-frontend-v4-staging.service
  systemctl status stellaratlas-frontend-v4-staging.service
EOF
