import { describe, expect, it } from '@jest/globals';
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderToStaticMarkup } from 'react-dom/server';
import { assetsAndIssuersGuide } from '../developer-guide-assets-and-issuers';
import { contractEventsGuide } from '../developer-guide-contract-events';

const section = assetsAndIssuersGuide.sections.find(
	(value) => value.id === 'wallet-and-holders'
);
if (!section) throw new Error('Missing wallet quickstart');
const html = renderToStaticMarkup(section.content);
const eventSection = contractEventsGuide.sections.find(
	(value) => value.id === 'request-events'
);
const eventContinuation = contractEventsGuide.sections.find(
	(value) => value.id === 'paginate-events'
);
if (!eventSection || !eventContinuation)
	throw new Error('Missing contract event request or continuation');
const decode = (text: string): string =>
	text.replace(
		/&(?:amp|lt|gt|quot|#x27);/g,
		(entity) =>
			({
				'&amp;': '&',
				'&lt;': '<',
				'&gt;': '>',
				'&quot;': '"',
				'&#x27;': "'"
			})[entity] ?? entity
	);
const commands = [
	...(
		html +
		renderToStaticMarkup(eventSection.content) +
		renderToStaticMarkup(eventContinuation.content)
	).matchAll(
		/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code>/g
	)
]
	.map((match) => decode(match[1]!))
	.filter((value) => value.includes('--output'));
// Shell fixtures simulate transfer outcomes and the cursor read.
const fakeCurl = `curl() {
 local destination write_status
 printf '%s\\n' "$@" > curl-args
 while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then shift; destination=$1; fi
  if [ "$1" = --write-out ]; then shift; write_status=$1; fi
  shift
 done
 printf '%s' "$RESPONSE" > "$destination"
 if [ "\${ROLE:-}" = success ]; then
  printf '%s' "$destination" > success-path
  printf 'ready\\n' > ready
  IFS= read -r release < release
 elif [ "\${ROLE:-}" = failure ]; then
  printf '%s' "$destination" > failure-path
 fi
 if [ "\${SIGNAL:-}" = TERM ]; then kill -TERM "$BASHPID"; fi
 if [ -n "$write_status" ]; then printf '%s' "\${HTTP_STATUS:-200:}"; fi
 return "$EXIT_CODE"
}
jq() {
 [ "$1" = -er ] && [ "$2" = '.nextCursor | strings | select(length > 0)' ] || return 2
 local page
 IFS= read -r page < "$3" || return 2
 case "$page" in
  '{"nextCursor":"opaque+/="}') printf '%s\\n' 'opaque+/=' ;;
  '{"nextCursor":null}') return 4 ;;
  *) return 2 ;;
 esac
}
`;
const saved =
	'{"balances":[{"balance":1234567890.1234567,"balanceRaw":null,"trustLineLimitRaw":"9223372036854775807"}],"nextCursor":"old-page"}\n';

const firstPage = '{"nextCursor":"opaque+/="}\n';
function seedFirstPage(directory: string, filename: string) {
	const previous = previousFile(filename);
	if (previous) writeFileSync(join(directory, previous), firstPage);
}
function previousFile(filename: string): string | undefined {
	if (filename === 'page-2.json') return 'page-1.json';
	if (filename.endsWith('-next.json')) return filename.replace('-next.json', '.json');
	return undefined;
}

describe('saved wallet, holder and event responses', () => {
	it('publishes six guarded save commands and distinguishes retained data from a fresh response', () => {
		expect(commands).toHaveLength(6);
		for (const text of [
			'refresh is unavailable',
			'not an empty',
			'label it as saved data',
			'watermark.catalogGeneratedAt',
			'generation time, not the time you saved',
			'pinned'
		])
			expect(html).toContain(text);
	});
	for (const command of commands) {
		const filename = command.match(
			/mktemp '\.\/([a-z0-9-]+\.json)\.partial\.XXXXXX'/
		)?.[1];
		if (!filename) throw new Error('Missing partial response destination');
		it.each([
			{
				label: 'HTTP failure',
				status: 22,
				body: '{"error":"warehouse unavailable"}'
			},
			{ label: 'interrupted transfer', status: 28, body: '{"balances":[' },
			{
				label: 'successful empty page',
				status: 0,
				body: '{"balances":[],"holders":[],"nextCursor":null}'
			},
			{
				label: 'successful numeric response',
				status: 0,
				body: saved.replace('old-page', 'next-page')
			}
		])(
			`${filename}: $label preserves the correct raw response`,
			({ status, body }) => {
				const directory = mkdtempSync(join(tmpdir(), 'wallet-guide-'));
				try {
					seedFirstPage(directory, filename);
					writeFileSync(join(directory, filename), saved);
					writeFileSync(
						join(directory, filename + '.partial.other'),
						'another invocation'
					);
					const result = spawnSync('/bin/bash', ['-c', fakeCurl + command], {
						cwd: directory,
						env: {
							NODE_ENV: 'test',
							PATH: '/usr/bin:/bin',
							RESPONSE: body,
							EXIT_CODE: String(status)
						},
						encoding: 'utf8',
						timeout: 5000
					});
					expect(result.status).toBe(status);
					expect(readFileSync(join(directory, filename), 'utf8')).toBe(
						status === 0 ? body : saved
					);
					const args = readFileSync(join(directory, 'curl-args'), 'utf8');
					expect(args.split('\n')[0]).toBe('-q');
					const previous = previousFile(filename);
					if (previous) {
						expect(
							readFileSync(
								join(directory, previous),
								'utf8'
							)
						).toBe(firstPage);
						expect(args).toContain(
							'--data-urlencode\nafter=opaque+/=\n'
						);
					}
					expect(
						readdirSync(directory).filter((name) =>
							name.startsWith(filename + '.partial.')
						)
					).toEqual([filename + '.partial.other']);
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			}
		);
		it(`${filename}: overlapping success and failure promote only the successful invocation's bytes`, () => {
			const directory = mkdtempSync(join(tmpdir(), 'wallet guide overlap '));
			try {
				seedFirstPage(directory, filename);
				writeFileSync(join(directory, filename), saved);
				const script =
					fakeCurl +
					`
mkfifo ready release
( ROLE=success; RESPONSE='successful bytes'; EXIT_CODE=0; ${command} ) & a=$!
trap 'kill "$a" "\${b:-$a}" 2>/dev/null || :' EXIT TERM INT
IFS= read -r ready_marker < ready
( ROLE=failure; RESPONSE='failed bytes'; EXIT_CODE=22; ${command} ) & b=$!
wait "$b"; failure_status=$?
printf 'release\\n' > release
wait "$a"; success_status=$?
printf '%s %s' "$success_status" "$failure_status"
`;
				const result = spawnSync('/bin/bash', ['-c', script], {
					cwd: directory,
					env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin' },
					encoding: 'utf8',
					timeout: 5000
				});
				expect(result.status).toBe(0);
				expect(result.stdout).toBe('0 22');
				expect(readFileSync(join(directory, filename), 'utf8')).toBe(
					'successful bytes'
				);
				expect(readFileSync(join(directory, 'success-path'), 'utf8')).not.toBe(
					readFileSync(join(directory, 'failure-path'), 'utf8')
				);
				expect(
					readdirSync(directory).filter((name) =>
						name.startsWith(filename + '.partial.')
					)
				).toEqual([]);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
		it.each([
			{
				label: 'rename failure',
				setup: 'mv() { return 73; }',
				status: 73,
				signal: ''
			},
			{
				label: 'temporary creation failure',
				setup: 'mktemp() { return 17; }',
				status: 17,
				signal: ''
			},
			{ label: 'TERM interruption', setup: '', status: 143, signal: 'TERM' }
		])(
			`${filename}: $label cleans only its own temporary and preserves caller state`,
			({ setup, status, signal }) => {
				const directory = mkdtempSync(join(tmpdir(), 'wallet guide cleanup '));
				try {
					seedFirstPage(directory, filename);
					writeFileSync(join(directory, filename), saved);
					writeFileSync(join(directory, 'caller-owned'), 'retain');
					const script =
						fakeCurl +
						`
temporary=caller-owned
trap 'printf x >> caller-exit' EXIT
trap ':' INT TERM
before=$(trap -p EXIT INT TERM)
${setup}
${command}
status=$?
after=$(trap -p EXIT INT TERM)
[ "$before" = "$after" ] && [ "$temporary" = caller-owned ] || exit 99
exit "$status"
`;
					const result = spawnSync('/bin/bash', ['-c', script], {
						cwd: directory,
						env: {
							NODE_ENV: 'test',
							PATH: '/usr/bin:/bin',
							RESPONSE: 'new bytes',
							EXIT_CODE: '0',
							SIGNAL: signal
						},
						encoding: 'utf8',
						timeout: 5000
					});
					expect(result.status).toBe(status);
					expect(readFileSync(join(directory, filename), 'utf8')).toBe(saved);
					expect(readFileSync(join(directory, 'caller-owned'), 'utf8')).toBe(
						'retain'
					);
					expect(readFileSync(join(directory, 'caller-exit'), 'utf8')).toBe(
						'x'
					);
					expect(
						readdirSync(directory).filter((name) =>
							name.startsWith(filename + '.partial.')
						)
					).toEqual([]);
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			}
		);
	}
	it.each([
		{ cursor: firstPage, http: '200:snapshot', status: 22 },
		{ cursor: firstPage, http: '302:', status: 22 },
		{ cursor: '{"nextCursor":null}\n', http: '200:', status: 4 }
	])('retains the next page when continuation exits $status ($http)', ({
		cursor,
		http,
		status
	}) => {
		const command = commands.find((value) => value.includes('wallet-balances-next.json'));
		if (!command) throw new Error('Missing wallet continuation');
		const directory = mkdtempSync(join(tmpdir(), 'wallet-guide-stop-'));
		try {
			writeFileSync(join(directory, 'wallet-balances.json'), cursor);
			writeFileSync(join(directory, 'wallet-balances-next.json'), saved);
			const result = spawnSync('/bin/bash', ['-c', fakeCurl + command], {
				cwd: directory,
				env: {
					NODE_ENV: 'test',
					PATH: '/usr/bin:/bin',
					HTTP_STATUS: http,
					RESPONSE: 'unexpected body',
					EXIT_CODE: '0'
				},
				encoding: 'utf8',
				timeout: 5000
			});
			expect(result.status).toBe(status);
			expect(readFileSync(join(directory, 'wallet-balances-next.json'), 'utf8')).toBe(saved);
			const entries = readdirSync(directory);
			expect(entries.some((name) => name.includes('.partial.'))).toBe(false);
			expect(entries.includes('curl-args')).toBe(status !== 4);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
