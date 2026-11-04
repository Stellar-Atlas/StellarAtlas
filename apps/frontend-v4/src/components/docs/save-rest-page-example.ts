import { api } from './developer-guide-elements';

export function saveRestPage(
	path: string,
	file: string,
	previous?: string,
	deadlineSeconds = 30
): string {
	const cursor = previous
		? `  after=$(jq -er '.nextCursor | strings | select(length > 0)' './${previous}') || exit
`
		: '';
	const query = previous ? ' --get --data-urlencode "after=$after"' : '';
	return `(
  trap - EXIT INT TERM
  trap 'exit 130' INT
  trap 'exit 143' TERM
${cursor}  temporary=$(mktemp './${file}.partial.XXXXXX') || exit
  trap 'rm -f -- "$temporary"' EXIT
  status=$(curl -q --fail-with-body --connect-timeout 5 --max-time ${deadlineSeconds} \\
    --write-out '%{http_code}:%header{x-stellaratlas-fallback}' \\
    '${api}${path}'${query} --output "$temporary") || exit
  if [[ $status != 2[0-9][0-9]: ]]; then
    printf '%s\\n' "Expected a live HTTP success, got $status" >&2
    exit 22
  fi
  mv -fT -- "$temporary" './${file}'
)`;
}
