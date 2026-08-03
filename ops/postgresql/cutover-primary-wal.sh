#!/usr/bin/env bash
set -euo pipefail

readonly data_dir=/mnt/bulk/stellarbeat-data/postgresql/16/main
readonly old_wal=/mnt/fast/stellarbeat-data/postgresql-wal/16/main
readonly nvme_mount=/mnt/stellaratlas-pgwal
readonly new_wal=$nvme_mount/16/main
readonly postgres_unit=stellaratlas-postgresql.service
readonly expected_device=/dev/mapper/vg_raid6-lv_stellaratlas_pgwal
readonly postgres_host=192.168.1.153
readonly postgres_port=55432
readonly -a writer_units=(
	stellaratlas-history-scanner.service
	stellaratlas-full-history-promotion.service
	stellaratlas-full-history-backfill.service
	stellaratlas-full-history-operation-backfill.service
	stellaratlas-full-history-ledger-close-meta.service
	stellaratlas-full-history-state-import.service
)

die() {
	printf 'cutover-primary-wal: %s\n' "$*" >&2
	exit 1
}

require_root() {
	[[ "$EUID" -eq 0 ]] || die 'run as root on the bare-metal host'
}

verify_common() {
	local source

	mountpoint --quiet "$nvme_mount" || die "$nvme_mount is not mounted"
	source=$(findmnt --noheadings --output SOURCE --target "$nvme_mount")
	[[ "$source" == "$expected_device" ]] ||
		die "$nvme_mount uses unexpected device $source"
	[[ -d "$old_wal" && -d "$new_wal" ]] || die 'WAL directories are missing'
	[[ "$(stat -c '%u:%g:%a' "$new_wal")" == '110:111:700' ]] ||
		die "$new_wal ownership or mode is wrong"
	grep -Fq "RequiresMountsFor=$data_dir $nvme_mount" \
		/etc/systemd/system/$postgres_unit ||
		die "$postgres_unit does not require the dedicated WAL mount"
}

stop_writers() {
	systemctl stop "${writer_units[@]}"
}

start_writers() {
	# Several writers wait for the VM API in ExecStartPre. Queue their starts so
	# an independently restarting API cannot make a successful WAL switch fail.
	systemctl start --no-block "${writer_units[@]}"
}

wait_for_postgres() {
	local attempt

	for attempt in {1..30}; do
		if /usr/lib/postgresql/16/bin/pg_isready \
			--host "$postgres_host" --port "$postgres_port" --timeout 1 \
			>/dev/null; then
			return 0
		fi
		sleep 1
	done
	return 1
}

restore_source() {
	local source=$1

	systemctl stop "$postgres_unit" >/dev/null 2>&1 || true
	ln -sfn "$source" "$data_dir/pg_wal.next"
	mv -Tf "$data_dir/pg_wal.next" "$data_dir/pg_wal"
	systemctl start "$postgres_unit"
	wait_for_postgres
	start_writers
}

switch_wal() {
	local source=$1
	local target=$2
	local link_target

	link_target=$(readlink -f "$data_dir/pg_wal")
	[[ "$link_target" == "$source" ]] ||
		die "pg_wal points to $link_target, expected $source"

	stop_writers
	systemctl stop "$postgres_unit"
	[[ ! -e "$data_dir/postmaster.pid" ]] || die 'PostgreSQL did not stop cleanly'

	if ! rsync -aHAX --numeric-ids --delete "$source/" "$target/" ||
		! sync -f "$target"; then
		restore_source "$source"
		die 'final WAL copy failed; restored PostgreSQL on the source path'
	fi
	ln -sfn "$target" "$data_dir/pg_wal.next"
	mv -Tf "$data_dir/pg_wal.next" "$data_dir/pg_wal"

	if ! systemctl start "$postgres_unit" || ! wait_for_postgres; then
		restore_source "$source"
		die 'PostgreSQL failed on the target WAL path; restored the source path'
	fi

	start_writers
}

main() {
	require_root
	verify_common
	case "${1:---check}" in
		--check)
			printf 'WAL cutover prerequisites are valid; current target: %s\n' \
				"$(readlink -f "$data_dir/pg_wal")"
			;;
		--cutover)
			switch_wal "$old_wal" "$new_wal"
			;;
		--rollback)
			switch_wal "$new_wal" "$old_wal"
			;;
		*)
			die 'usage: cutover-primary-wal.sh [--check|--cutover|--rollback]'
			;;
	esac
}

main "$@"
