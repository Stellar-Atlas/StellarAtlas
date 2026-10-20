#!/usr/bin/env bash
set -euo pipefail

# Keep peer cleanup on the main thread while investigating the Core 30
# TCPPeer destructor assertion. No ledger or signature checks are disabled.
core=/mnt/bulk/stellarbeat-data/stellar-core/bin/stellar-core
args=("$@")
config=
position=
inline=0
for ((index=0; index<${#args[@]}; index++)); do
  if [[ "${args[index]}" == --conf ]]; then
    position=$((index+1))
    config=${args[position]:-}
    break
  elif [[ "${args[index]}" == --conf=* ]]; then
    position=$index
    config=${args[index]#--conf=}
    inline=1
    break
  fi
done

if [[ -n "$position" ]]; then
  [[ -f "$config" && -r "$config" ]] || { printf 'Core configuration is not readable\n' >&2; exit 64; }
  # Preserve inherited descriptors: RPC uses fd 3 for ledger metadata.
  # This private, memory-only config disappears at reboot; generated files stay intact.
  temporary=$(mktemp /dev/shm/stellaratlas-core-main-overlay-XXXXXXXX.cfg)
  chmod 600 "$temporary"
  { printf 'BACKGROUND_OVERLAY_PROCESSING=false\n'; awk '!/^[[:space:]]*BACKGROUND_OVERLAY_PROCESSING[[:space:]]*=/' "$config"; } > "$temporary"
  if [[ "$inline" -eq 1 ]]; then args[position]=--conf="$temporary";
  else args[position]="$temporary"; fi
fi

exec "$core" "${args[@]}"
