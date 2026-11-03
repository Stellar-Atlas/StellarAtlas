import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderToStaticMarkup } from 'react-dom/server';
import { assetsAndIssuersGuide } from '../developer-guide-assets-and-issuers';

const section = assetsAndIssuersGuide.sections.find(
	(value) => value.id === 'wallet-and-holders'
);
if (!section) throw new Error('Missing wallet quickstart');
const html = renderToStaticMarkup(section.content);
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
	...html.matchAll(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code>/g)
]
	.map((match) => decode(match[1]!))
	.filter((value) => value.includes('--output'));
// A shell function replaces curl: no request or socket is made.
const fakeCurl = `curl() {
 while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then shift; destination=$1; fi
  shift
 done
 printf '%s' "$RESPONSE" > "$destination"
 return "$EXIT_CODE"
}
`;
const saved =
	'{"balances":[{"balance":1234567890.1234567,"balanceRaw":null,"trustLineLimitRaw":"9223372036854775807"}],"nextCursor":"old-page"}\n';

describe('saved wallet and holder responses', () => {
	it('publishes two guarded save commands and distinguishes retained data from a fresh response', () => {
		expect(commands).toHaveLength(2);
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
		const filename = command.match(/--output ([a-z-]+\.json)\.partial/)?.[1];
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
					writeFileSync(join(directory, filename), saved);
					const result = spawnSync('/bin/bash', ['-c', fakeCurl + command], {
						cwd: directory,
						env: {
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
				} finally {
					rmSync(directory, { recursive: true, force: true });
				}
			}
		);
	}
});
