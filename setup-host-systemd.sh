#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SOURCE="$REPO_ROOT/ops/systemd/host"
UNIT_TARGET=/etc/systemd/system
PRIMARY_CONFIG_SOURCE="$REPO_ROOT/ops/postgresql/host"
PRIMARY_CONFIG_TARGET=/etc/postgresql/16/stellaratlas
HORIZON_CONFIG_TARGET=/etc/postgresql/16/stellaratlas-horizon
STELLARATLAS_CONFIG_TARGET=/etc/stellaratlas
ARCHIVE_VERIFIER_ENV_SOURCE="$REPO_ROOT/ops/systemd/archive-verifier-steady.env"
ARCHIVE_VERIFIER_ENV_TARGET="$STELLARATLAS_CONFIG_TARGET/archive-verifier-steady.env"
NATS_CONFIG_SOURCE="$REPO_ROOT/ops/nats/stellaratlas.conf"
NATS_CONFIG_TARGET="$STELLARATLAS_CONFIG_TARGET/nats.conf"
NATS_ENV_TARGET="$STELLARATLAS_CONFIG_TARGET/nats.env"
NATS_STATE_DIR=/var/lib/stellaratlas/nats

UNITS=(
	stellaratlas-postgresql.service
	stellaratlas-nats.service
	stellaratlas-history-archive-dispatcher.service
	stellaratlas-history-scanner.service
	stellaratlas-full-history-promotion.service
	stellaratlas-full-history-backfill.service
	stellaratlas-full-history-operation-backfill.service
	stellaratlas-full-history-ledger-close-meta.service
	stellaratlas-full-history-state-import.service
	stellaratlas-horizon-postgres.service
	stellaratlas-horizon.service
	stellaratlas-stellar-rpc.service
	stellaratlas-meilisearch-network.service
)

die() {
	printf 'setup-host-systemd: %s\n' "$*" >&2
	exit 1
}

require_file() {
	[[ -f "$1" ]] || die "missing required file: $1"
}

require_executable() {
	[[ -x "$1" ]] || die "missing required executable: $1"
}

verify_copy() {
	local source="$1"
	local target="$2"
	local expected="$3"

	cmp --silent "$source" "$target" || die "installed file is stale: $target"
	[[ "$(stat -c '%u:%g:%a' "$target")" == "$expected" ]] ||
		die "installed ownership or mode is wrong: $target"
}

verify_prerequisites() {
	local unit

	[[ "$EUID" -eq 0 ]] || die "run this installer as root on the bare-metal host"
	[[ -d /mnt/bulk/stellarbeat-data ]] ||
		die "/mnt/bulk/stellarbeat-data is not mounted"
	mountpoint --quiet /mnt/stellaratlas-pgwal ||
		die "/mnt/stellaratlas-pgwal is not mounted"
	getent passwd admins >/dev/null || die "host user admins is missing"
	getent group admins >/dev/null || die "host group admins is missing"
	require_executable /usr/lib/postgresql/16/bin/postgres
	require_executable /home/admins/.nvm/versions/node/v26.5.1/bin/node
	require_executable /home/admins/.nvm/versions/node/v26.5.1/bin/pnpm
	require_executable /home/admins/.local/bin/meilisearch
	require_executable /usr/sbin/nats-server
	require_executable /usr/bin/openssl
	require_executable /mnt/bulk/stellarbeat-data/horizon/bin/horizon
	require_executable /mnt/bulk/stellarbeat-data/stellar-rpc/bin/stellar-rpc
	require_executable /mnt/bulk/stellarbeat-data/stellar-core/bin/stellar-core
	require_file "$STELLARATLAS_CONFIG_TARGET/meilisearch-network.env"
	grep -Eq '^MEILI_MASTER_KEY=.{16,}$' \
		"$STELLARATLAS_CONFIG_TARGET/meilisearch-network.env" ||
		die "host Meilisearch master key is missing"

	for unit in "${UNITS[@]}"; do
		require_file "$UNIT_SOURCE/$unit"
	done

	require_file "$PRIMARY_CONFIG_SOURCE/postgresql.conf"
	require_file "$PRIMARY_CONFIG_SOURCE/pg_hba.conf"
	require_file "$PRIMARY_CONFIG_SOURCE/pg_ident.conf"
	require_file "$PRIMARY_CONFIG_SOURCE/horizon-postgresql.conf"
	require_file "$PRIMARY_CONFIG_SOURCE/horizon-pg_hba.conf"
	require_file "$PRIMARY_CONFIG_SOURCE/horizon-pg_ident.conf"
	require_file "$REPO_ROOT/ops/postgresql/stellaratlas-main.conf"
	require_file "$NATS_CONFIG_SOURCE"
        require_file "$ARCHIVE_VERIFIER_ENV_SOURCE"
	require_file "$REPO_ROOT/ops/stellar-rpc/pubnet-host.toml"

	systemd-analyze verify "${UNITS[@]/#/$UNIT_SOURCE/}"
}

install_runtime() {
	local unit

	install -d -o root -g root -m 0755 \
		"$PRIMARY_CONFIG_TARGET/conf.d" \
		"$HORIZON_CONFIG_TARGET" \
		"$STELLARATLAS_CONFIG_TARGET"
	install -d -o admins -g admins -m 0750 "$NATS_STATE_DIR"
	if [[ ! -s "$NATS_ENV_TARGET" ]]; then
		printf 'NATS_TOKEN=%s\n' "$(openssl rand -hex 32)" >"$NATS_ENV_TARGET"
	fi
	chown root:admins "$NATS_ENV_TARGET"
	chmod 0640 "$NATS_ENV_TARGET"
	grep -Eq '^NATS_TOKEN=[0-9a-f]{64}$' "$NATS_ENV_TARGET" ||
		die "host NATS token is missing or invalid"
	install -o root -g admins -m 0640 \
		"$NATS_CONFIG_SOURCE" "$NATS_CONFIG_TARGET"
        install -o root -g root -m 0644 \
                "$ARCHIVE_VERIFIER_ENV_SOURCE" "$ARCHIVE_VERIFIER_ENV_TARGET"
	install -o root -g 111 -m 0640 \
		"$PRIMARY_CONFIG_SOURCE/postgresql.conf" \
		"$PRIMARY_CONFIG_TARGET/postgresql.conf"
	install -o root -g 111 -m 0640 \
		"$PRIMARY_CONFIG_SOURCE/pg_hba.conf" \
		"$PRIMARY_CONFIG_TARGET/pg_hba.conf"
	install -o root -g 111 -m 0640 \
		"$PRIMARY_CONFIG_SOURCE/pg_ident.conf" \
		"$PRIMARY_CONFIG_TARGET/pg_ident.conf"
	install -o root -g 111 -m 0640 \
		"$REPO_ROOT/ops/postgresql/stellaratlas-main.conf" \
		"$PRIMARY_CONFIG_TARGET/conf.d/stellaratlas-main.conf"
	install -o root -g admins -m 0640 \
		"$PRIMARY_CONFIG_SOURCE/horizon-postgresql.conf" \
		"$HORIZON_CONFIG_TARGET/postgresql.conf"
	install -o root -g admins -m 0640 \
		"$PRIMARY_CONFIG_SOURCE/horizon-pg_hba.conf" \
		"$HORIZON_CONFIG_TARGET/pg_hba.conf"
	install -o root -g admins -m 0640 \
		"$PRIMARY_CONFIG_SOURCE/horizon-pg_ident.conf" \
		"$HORIZON_CONFIG_TARGET/pg_ident.conf"
	install -o root -g root -m 0644 \
		"$REPO_ROOT/ops/stellar-rpc/pubnet-host.toml" \
		"$STELLARATLAS_CONFIG_TARGET/stellar-rpc.toml"

	for unit in "${UNITS[@]}"; do
		install -o root -g root -m 0644 \
			"$UNIT_SOURCE/$unit" "$UNIT_TARGET/$unit"
	done

	systemctl disable --now nats-server.service 2>/dev/null || true
	systemctl mask nats-server.service
	systemctl daemon-reload
	systemctl enable "${UNITS[@]}"
	printf 'Installed and enabled %d host-native StellarAtlas services.\n' \
		"${#UNITS[@]}"
}

verify_installed() {
	local unit

	for unit in "${UNITS[@]}"; do
		cmp --silent "$UNIT_SOURCE/$unit" "$UNIT_TARGET/$unit" ||
			die "installed unit is stale: $unit"
	done
	verify_copy "$PRIMARY_CONFIG_SOURCE/postgresql.conf" \
		"$PRIMARY_CONFIG_TARGET/postgresql.conf" '0:111:640'
	verify_copy "$PRIMARY_CONFIG_SOURCE/pg_hba.conf" \
		"$PRIMARY_CONFIG_TARGET/pg_hba.conf" '0:111:640'
	verify_copy "$PRIMARY_CONFIG_SOURCE/pg_ident.conf" \
		"$PRIMARY_CONFIG_TARGET/pg_ident.conf" '0:111:640'
	verify_copy "$REPO_ROOT/ops/postgresql/stellaratlas-main.conf" \
		"$PRIMARY_CONFIG_TARGET/conf.d/stellaratlas-main.conf" '0:111:640'
	verify_copy "$NATS_CONFIG_SOURCE" "$NATS_CONFIG_TARGET" '0:1000:640'
        install -o root -g root -m 0644 \
                "$ARCHIVE_VERIFIER_ENV_SOURCE" "$ARCHIVE_VERIFIER_ENV_TARGET"
        verify_copy "$ARCHIVE_VERIFIER_ENV_SOURCE" \
                "$ARCHIVE_VERIFIER_ENV_TARGET" '0:0:644'
	[[ "$(stat -c '%u:%g:%a' "$NATS_ENV_TARGET")" == '0:1000:640' ]] ||
		die "installed ownership or mode is wrong: $NATS_ENV_TARGET"
	grep -Eq '^NATS_TOKEN=[0-9a-f]{64}$' "$NATS_ENV_TARGET" ||
		die "host NATS token is missing or invalid"
	verify_copy "$PRIMARY_CONFIG_SOURCE/horizon-postgresql.conf" \
		"$HORIZON_CONFIG_TARGET/postgresql.conf" '0:1000:640'
	verify_copy "$PRIMARY_CONFIG_SOURCE/horizon-pg_hba.conf" \
		"$HORIZON_CONFIG_TARGET/pg_hba.conf" '0:1000:640'
	verify_copy "$PRIMARY_CONFIG_SOURCE/horizon-pg_ident.conf" \
		"$HORIZON_CONFIG_TARGET/pg_ident.conf" '0:1000:640'
	verify_copy "$REPO_ROOT/ops/stellar-rpc/pubnet-host.toml" \
		"$STELLARATLAS_CONFIG_TARGET/stellar-rpc.toml" '0:0:644'
	systemd-analyze verify "${UNITS[@]/#/$UNIT_TARGET/}"
	printf 'Verified %d installed host-native StellarAtlas services.\n' \
		"${#UNITS[@]}"
}

case "${1:---install}" in
	--install)
		verify_prerequisites
		install_runtime
		verify_installed
		;;
	--verify)
		verify_prerequisites
		verify_installed
		;;
	*)
		die "usage: sudo ./setup-host-systemd.sh [--install|--verify]"
		;;
esac
