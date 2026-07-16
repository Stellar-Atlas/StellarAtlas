#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_SOURCE_DIR="$REPO_ROOT/ops/systemd"
SYSTEMD_UNIT_DIR="/etc/systemd/system"
POLKIT_RULE_DIR="/etc/polkit-1/rules.d"
EXPECTED_REPO_ROOT="/home/observe/stellarbeat-data/Observer"
NETWORK_MEILI_ENV_DIR="/etc/stellaratlas"
NETWORK_MEILI_ENV_FILE="$NETWORK_MEILI_ENV_DIR/meilisearch-network.env"
NETWORK_MEILI_DATA_ROOT="/home/observe/stellarbeat-data/meilisearch/network"
FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE="$EXPECTED_REPO_ROOT/apps/full-history-etl/bin/stellaratlas-full-history-etl"
FULL_HISTORY_STATE_EXPORT_EXECUTABLE="$EXPECTED_REPO_ROOT/apps/full-history-etl/bin/stellaratlas-full-history-state-export"
NETWORK_MEILI_RUNTIME_DIRS=(
	"$NETWORK_MEILI_DATA_ROOT"
	"$NETWORK_MEILI_DATA_ROOT/data"
	"$NETWORK_MEILI_DATA_ROOT/dumps"
	"$NETWORK_MEILI_DATA_ROOT/snapshots"
)

INSTALL_UNIT_NAMES=(
	stellaratlas.target
	stellaratlas-api.service
	stellaratlas-frontend-v4.service
	stellaratlas-frontend-v4-staging.service
	stellaratlas-frontend-legacy.service
	stellaratlas-meilisearch-network.service
	stellaratlas-network-scanner.service
	stellaratlas-scp-live-scanner.service
	stellaratlas-users.service
	stellaratlas-history-scanner@.service
	stellaratlas-full-history-promotion.service
	stellaratlas-full-history-backfill.service
	stellaratlas-full-history-operation-backfill.service
	stellaratlas-full-history-ledger-close-meta.service
	stellaratlas-full-history-state-import.service
	stellaratlas-horizon.service
	stellaratlas-stellar-rpc.service
)

VERIFY_UNIT_NAMES=(
	"${INSTALL_UNIT_NAMES[@]}"
	stellaratlas-api-docs-comparison-refresh.service
	stellaratlas-api-docs-comparison-refresh.timer
	stellaratlas-radar-network-comparison-refresh.service
	stellaratlas-radar-network-comparison-refresh.timer
)

die() {
	printf 'setup-systemd: %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage:
  sudo ./setup-systemd.sh       Install and activate the boot-safe unit copies.
  ./setup-systemd.sh --verify   Validate tracked unit templates without changes.
  ./setup-systemd.sh --verify-installed
                                Verify the installed boot contract without changes.
EOF
}

verify_source_units() {
	local file_name
	local -a unit_paths=()
	local ledger_close_meta_unit="$SYSTEMD_SOURCE_DIR/stellaratlas-full-history-ledger-close-meta.service"
	local state_import_unit="$SYSTEMD_SOURCE_DIR/stellaratlas-full-history-state-import.service"
	local horizon_unit="$SYSTEMD_SOURCE_DIR/stellaratlas-horizon.service"
	local stellar_rpc_unit="$SYSTEMD_SOURCE_DIR/stellaratlas-stellar-rpc.service"

	command -v systemd-analyze >/dev/null || die "systemd-analyze is required"

	for file_name in "${VERIFY_UNIT_NAMES[@]}"; do
		[[ -f "$SYSTEMD_SOURCE_DIR/$file_name" ]] ||
			die "missing unit template: $file_name"
		[[ ! -L "$SYSTEMD_SOURCE_DIR/$file_name" ]] ||
			die "unit template must be a regular file: $file_name"
		unit_paths+=("$SYSTEMD_SOURCE_DIR/$file_name")
	done

	systemd-analyze verify "${unit_paths[@]}"
	grep -Fqx \
		"RequiresMountsFor=$EXPECTED_REPO_ROOT" \
		"$SYSTEMD_SOURCE_DIR/stellaratlas.target" ||
		die "stellaratlas.target must require the repository mount"
	grep -Fqx \
		"RequiresMountsFor=/home/observe/stellarbeat-data" \
		"$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must require the bulk mount"
	grep -Fqx \
		"ConditionFileIsExecutable=$FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE" \
		"$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must be gated by its executable"
	grep -Fqx "MemorySwapMax=0" "$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must not use swap"
	grep -Fqx "MemoryMax=64G" "$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must use a 64G memory ceiling"
	grep -Fqx "CPUQuota=800%" "$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must use a bounded CPU quota"
	grep -Fqx "Restart=always" "$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must restart automatically"
	grep -Fqx "Environment=FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY=12" \
		"$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must cap fetch concurrency at 12"
	grep -Fqx "Environment=FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY=4" \
		"$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must cap processing concurrency at 4"
	grep -Fqx "Environment=FULL_HISTORY_LEDGER_CLOSE_META_INGRESS_BYTES_PER_SECOND=187500000" \
		"$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must cap aggregate ingress at 1.5 Gbps"
	if grep -Fq "FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER=" \
		"$ledger_close_meta_unit"; then
		die "Continuous LedgerCloseMeta ingestion must not have a terminal ledger"
	fi
	grep -Fq "stellaratlas-full-history-ledger-close-meta.service" \
		"$SYSTEMD_SOURCE_DIR/stellaratlas.target" ||
		die "LedgerCloseMeta ingestion must start with the production target"
	grep -Fqx "LimitCORE=0" "$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must disable core dumps"
	grep -Fqx "UMask=0077" "$ledger_close_meta_unit" ||
		die "LedgerCloseMeta ingestion must use umask 0077"
	grep -Fq \
		'"stellaratlas-full-history-ledger-close-meta.service"' \
		"$SYSTEMD_SOURCE_DIR/10-stellaratlas-observe.rules" ||
		die "observe must be authorized to manage LedgerCloseMeta ingestion"
	grep -Fqx \
		"ConditionFileIsExecutable=$FULL_HISTORY_STATE_EXPORT_EXECUTABLE" \
		"$state_import_unit" ||
		die "State import must be gated by its exporter executable"
	grep -Fqx "Environment=FULL_HISTORY_STATE_IMPORT_WORKERS=4" \
		"$state_import_unit" ||
		die "State import must use four bounded workers"
	grep -Fqx "MemorySwapMax=0" "$state_import_unit" ||
		die "State import must not use swap"
	grep -Fqx "MemoryMax=32G" "$state_import_unit" ||
		die "State import must use a 32G memory ceiling"
	grep -Fqx "CPUQuota=800%" "$state_import_unit" ||
		die "State import must use a bounded CPU quota"
	grep -Fqx "Restart=on-failure" "$state_import_unit" ||
		die "State import must restart automatically"
	grep -Fq "stellaratlas-full-history-state-import.service" \
		"$SYSTEMD_SOURCE_DIR/stellaratlas.target" ||
		die "State import must start with the production target"
	grep -Fq \
		'"stellaratlas-full-history-state-import.service"' \
		"$SYSTEMD_SOURCE_DIR/10-stellaratlas-observe.rules" ||
		die "observe must be authorized to manage state import"
	grep -Fqx \
		"RequiresMountsFor=/home/observe/stellarbeat-data" \
		"$horizon_unit" ||
		die "Horizon must require the bulk mount"
	grep -Fqx \
		"RequiresMountsFor=/home/observe/stellarbeat-data" \
		"$stellar_rpc_unit" ||
		die "Stellar RPC must require the bulk mount"

	printf 'Verified %d tracked systemd unit templates.\n' "${#unit_paths[@]}"
}

verify_regular_copy() {
	local source="$1"
	local target="$2"

	[[ -f "$target" ]] || die "installed file is missing: $target"
	[[ ! -L "$target" ]] || die "installed file must not be a symlink: $target"
	cmp --silent "$source" "$target" || die "installed file is stale: $target"
	[[ "$(stat -c '%U:%G:%a' "$target")" == "root:root:644" ]] ||
		die "installed file must be root:root mode 0644: $target"
}

verify_installed_polkit_rule() {
	if [[ "$EUID" -eq 0 ]]; then
		verify_regular_copy \
			"$SYSTEMD_SOURCE_DIR/10-stellaratlas-observe.rules" \
			"$POLKIT_RULE_DIR/10-stellaratlas-observe.rules"
		return
	fi

	# The protected polkit directory is intentionally unreadable by observe.
	# A no-prompt reset of an active target proves the installed rule authorizes
	# the operator without interrupting any service.
	systemctl --no-ask-password reset-failed stellaratlas.target >/dev/null ||
		die "installed polkit rule does not authorize non-root service management"
}

verify_network_meilisearch_runtime() {
	local directory

	[[ -f "$NETWORK_MEILI_ENV_FILE" ]] ||
		die "network Meilisearch env is missing: $NETWORK_MEILI_ENV_FILE"
	[[ ! -L "$NETWORK_MEILI_ENV_FILE" ]] ||
		die "network Meilisearch env must not be a symlink"
	[[ "$(stat -c '%U:%G:%a' "$NETWORK_MEILI_ENV_FILE")" == \
		"root:observe:640" ]] ||
		die "network Meilisearch env must be root:observe mode 0640"
	grep -Eq '^MEILI_MASTER_KEY=.{16,}$' "$NETWORK_MEILI_ENV_FILE" ||
		die "network Meilisearch env has no usable master key"
	grep -Eq '^MEILISEARCH_NETWORK_HOST=.+$' "$NETWORK_MEILI_ENV_FILE" ||
		die "network Meilisearch env has no network host"
	grep -Eq '^MEILISEARCH_NETWORK_API_KEY=.{16,}$' \
		"$NETWORK_MEILI_ENV_FILE" ||
		die "network Meilisearch env has no usable API key"

	for directory in "${NETWORK_MEILI_RUNTIME_DIRS[@]}"; do
		[[ -d "$directory" ]] ||
			die "network Meilisearch runtime directory is missing: $directory"
		[[ ! -L "$directory" ]] ||
			die "network Meilisearch runtime directory must not be a symlink"
		[[ "$(stat -c '%U:%G:%a' "$directory")" == "observe:observe:700" ]] ||
			die "network Meilisearch runtime directory must be observe:observe mode 0700"
	done
}

provision_network_meilisearch_runtime() {
	local directory
	local master_key
	local staged

	install -d -o root -g root -m 0755 "$NETWORK_MEILI_ENV_DIR"
	[[ ! -L "$NETWORK_MEILI_ENV_FILE" ]] ||
		die "network Meilisearch env must not be a symlink"

	if [[ ! -e "$NETWORK_MEILI_ENV_FILE" ]]; then
		command -v openssl >/dev/null || die "openssl is required"
		master_key="$(openssl rand -hex 32)"
		[[ "$master_key" =~ ^[[:xdigit:]]{64}$ ]] ||
			die "failed to generate network Meilisearch credentials"
		staged="$(
			mktemp --tmpdir="$NETWORK_MEILI_ENV_DIR" \
				'.meilisearch-network.env.XXXXXX'
		)"
		if ! {
			printf 'MEILI_MASTER_KEY=%s\n' "$master_key"
			printf 'MEILISEARCH_NETWORK_HOST=http://127.0.0.1:7701\n'
			printf 'MEILISEARCH_NETWORK_API_KEY=%s\n' "$master_key"
		} >"$staged"; then
			rm -f "$staged"
			die "failed to write network Meilisearch credentials"
		fi
		master_key=''
		if ! chown root:observe "$staged" || ! chmod 0640 "$staged"; then
			rm -f "$staged"
			die "failed to secure network Meilisearch credentials"
		fi
		if ! ln "$staged" "$NETWORK_MEILI_ENV_FILE" 2>/dev/null; then
			[[ -f "$NETWORK_MEILI_ENV_FILE" && ! -L "$NETWORK_MEILI_ENV_FILE" ]] || {
				rm -f "$staged"
				die "failed to install network Meilisearch credentials"
			}
		fi
		rm -f "$staged"
	fi

	[[ -f "$NETWORK_MEILI_ENV_FILE" ]] ||
		die "network Meilisearch env must be a regular file"
	chown root:observe "$NETWORK_MEILI_ENV_FILE"
	chmod 0640 "$NETWORK_MEILI_ENV_FILE"
	for directory in "${NETWORK_MEILI_RUNTIME_DIRS[@]}"; do
		install -d -o observe -g observe -m 0700 "$directory"
	done
	verify_network_meilisearch_runtime
}

verify_installed_units() {
	local file_name
	local legacy_unit="$SYSTEMD_UNIT_DIR/stellaratlas.service"
	local fragment_path
	local required_mounts

	for file_name in "${INSTALL_UNIT_NAMES[@]}"; do
		verify_regular_copy \
			"$SYSTEMD_SOURCE_DIR/$file_name" \
			"$SYSTEMD_UNIT_DIR/$file_name"
	done

	verify_installed_polkit_rule
	verify_network_meilisearch_runtime

	[[ -L "$legacy_unit" ]] || die "legacy stellaratlas.service is not masked"
	[[ "$(readlink "$legacy_unit")" == "/dev/null" ]] ||
		die "legacy stellaratlas.service mask does not point to /dev/null"

	fragment_path="$(
		systemctl show stellaratlas.target --property=FragmentPath --value
	)"
	[[ "$fragment_path" == "$SYSTEMD_UNIT_DIR/stellaratlas.target" ]] ||
		die "systemd has not loaded the installed stellaratlas.target copy"
	required_mounts="$(
		systemctl show stellaratlas.target --property=RequiresMountsFor --value
	)"
	[[ " $required_mounts " == *" $EXPECTED_REPO_ROOT "* ]] ||
		die "loaded stellaratlas.target does not require the repository mount"
	systemctl is-enabled --quiet stellaratlas.target ||
		die "stellaratlas.target is not enabled"
	systemctl is-enabled --quiet stellaratlas-full-history-backfill.service ||
		die "stellaratlas-full-history-backfill.service is not enabled"
	systemctl is-enabled --quiet stellaratlas-full-history-ledger-close-meta.service ||
		die "stellaratlas-full-history-ledger-close-meta.service is not enabled"
	systemctl is-enabled --quiet stellaratlas-full-history-state-import.service ||
		die "stellaratlas-full-history-state-import.service is not enabled"

	printf 'Verified installed boot-safe systemd unit copies.\n'
}

install_regular_file() {
	local source="$1"
	local target="$2"
	local directory="${target%/*}"
	local file_name="${target##*/}"
	local staged

	if [[ ! -d "$directory" ]]; then
		install -d -o root -g root -m 0755 "$directory"
	fi

	staged="$(mktemp --tmpdir="$directory" ".$file_name.XXXXXX")"
	if ! install -o root -g root -m 0644 -T "$source" "$staged"; then
		rm -f "$staged"
		return 1
	fi
	if ! mv -fT "$staged" "$target"; then
		rm -f "$staged"
		return 1
	fi
}

install_units() {
	local file_name

	for file_name in "${INSTALL_UNIT_NAMES[@]}"; do
		install_regular_file \
			"$SYSTEMD_SOURCE_DIR/$file_name" \
			"$SYSTEMD_UNIT_DIR/$file_name"
	done

	install_regular_file \
		"$SYSTEMD_SOURCE_DIR/10-stellaratlas-observe.rules" \
		"$POLKIT_RULE_DIR/10-stellaratlas-observe.rules"
}

mask_legacy_unit() {
	systemctl disable --now stellaratlas.service >/dev/null 2>&1 || true
	rm -f "$SYSTEMD_UNIT_DIR/stellaratlas.service"
	ln -sT /dev/null "$SYSTEMD_UNIT_DIR/stellaratlas.service"
}

main() {
	case "${1:-}" in
	--verify)
		[[ "$#" -eq 1 ]] || die "--verify accepts no additional arguments"
		verify_source_units
		return
		;;
	--verify-installed)
		[[ "$#" -eq 1 ]] ||
			die "--verify-installed accepts no additional arguments"
		verify_source_units
		verify_installed_units
		return
		;;
	--help | -h)
		usage
		return
		;;
	"")
		;;
	*)
		usage >&2
		die "unknown argument: $1"
		;;
	esac

	[[ "$#" -eq 0 ]] || die "installation accepts no arguments"
	[[ "$EUID" -eq 0 ]] || die "run installation with sudo"
	[[ "$REPO_ROOT" == "$EXPECTED_REPO_ROOT" ]] ||
		die "repository must be at $EXPECTED_REPO_ROOT"

	verify_source_units
	provision_network_meilisearch_runtime
	install_units
	mask_legacy_unit
	systemctl daemon-reload
	systemctl enable stellaratlas-full-history-backfill.service
	systemctl enable stellaratlas-full-history-ledger-close-meta.service
	systemctl enable stellaratlas-full-history-state-import.service
	systemctl enable --now stellaratlas.target
	systemctl start stellaratlas-full-history-promotion.service
	systemctl start stellaratlas-full-history-backfill.service
	systemctl start stellaratlas-full-history-operation-backfill.service
	systemctl start stellaratlas-full-history-ledger-close-meta.service
	systemctl start stellaratlas-full-history-state-import.service
	verify_installed_units
	systemctl is-active --quiet stellaratlas.target ||
		die "stellaratlas.target is not active"
	systemctl is-active --quiet stellaratlas-full-history-promotion.service ||
		die "stellaratlas-full-history-promotion.service is not active"
	systemctl is-active --quiet stellaratlas-full-history-backfill.service ||
		die "stellaratlas-full-history-backfill.service is not active"
	systemctl is-active --quiet stellaratlas-full-history-operation-backfill.service ||
		die "stellaratlas-full-history-operation-backfill.service is not active"
	systemctl is-active --quiet stellaratlas-full-history-ledger-close-meta.service ||
		die "stellaratlas-full-history-ledger-close-meta.service is not active"
	systemctl is-active --quiet stellaratlas-full-history-state-import.service ||
		die "stellaratlas-full-history-state-import.service is not active"

	cat <<'EOF'
Installed boot-safe local copies of the split StellarAtlas units.
The obsolete stellaratlas.service is masked. An already-active target was not
restarted; canonical promotion, historical backfill, operation catch-up,
LedgerCloseMeta ingestion, and typed state import were started explicitly.
EOF
	cat <<'EOF'

LedgerCloseMeta ingestion is target-managed and continuously resumes from its
durable watermark. Aggregate ingress, fetch/process concurrency, CPU, memory,
stored bytes, and free-space reserve are bounded by the tracked unit.

Production:
  systemctl status stellaratlas.target
  # Restart only a changed component during normal deploys. Restarting the
  # target also stops the public ingress proxy and causes avoidable downtime.
  systemctl restart stellaratlas-meilisearch-network.service
  systemctl restart stellaratlas-api.service
  systemctl restart stellaratlas-frontend-v4.service
  systemctl restart stellaratlas-network-scanner.service
  systemctl restart stellaratlas-scp-live-scanner.service
  systemctl restart stellaratlas-history-scanner@1.service
  systemctl restart stellaratlas-full-history-promotion.service
  systemctl restart stellaratlas-full-history-backfill.service
  systemctl restart stellaratlas-full-history-operation-backfill.service
  systemctl restart stellaratlas-full-history-ledger-close-meta.service
  systemctl restart stellaratlas-full-history-state-import.service

Local full-history services, after binaries/config/DB exist:
  systemctl start stellaratlas-horizon.service
  systemctl start stellaratlas-stellar-rpc.service

Staging frontend:
  pnpm build:frontend-v4:staging
  systemctl start stellaratlas-frontend-v4-staging.service
  systemctl status stellaratlas-frontend-v4-staging.service
EOF
}

main "$@"
