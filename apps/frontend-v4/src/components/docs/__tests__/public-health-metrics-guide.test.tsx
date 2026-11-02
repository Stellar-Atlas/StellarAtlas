import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { getDeveloperGuidePage } from '../developer-guide-content';
import fixtures from '../public-health-fixtures.json' with { type: 'json' };

function renderSection(): string {
	const section = getDeveloperGuidePage('services')?.sections.find(
		(value) => value.id === 'public-health-metrics'
	);
	if (!section) throw new Error('Missing public health/metrics section');
	return renderToStaticMarkup(createElement(Fragment, null, section.content));
}

const escaped = (text: string) =>
	renderToStaticMarkup(createElement('code', null, text)).slice(
		'<code>'.length,
		-'</code>'.length
	);
const blocks = () =>
	[
		...renderSection().matchAll(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code>/g)
	].map((match) => match[1]);

describe('public readiness and metrics guide', () => {
	it.each([
		{ kind: 'health', index: 0, filename: 'health.json' },
		{ kind: 'metrics', index: 1, filename: 'metrics.json' }
	])(
		'renders exact bounded $kind request preserving error bodies and HTTP status',
		({ kind, index, filename }) => {
			const command = `curl --fail-with-body --connect-timeout 5 --max-time 10 \\
  --write-out 'HTTP %{http_code}\\n' \\
  'https://api.stellaratlas.io/v1/public-goods/${kind}' --output ${filename}`;
			expect(blocks()[index]).toBe(escaped(command));
			expect(command).not.toContain('--retry');
		}
	);

	it('renders exact source-backed HTTP503 health and HTTP200 metrics examples', () => {
		const selected = fixtures.filter(
			(row) => row.scenario === 'stale-incomplete'
		);
		expect(selected.map((row) => row.status)).toEqual([503, 200]);
		expect(blocks().slice(2)).toEqual(
			selected.map((row) => escaped(JSON.stringify(row.body, null, 2)))
		);
		expect(renderSection()).toContain('not a live status report');
		expect(renderSection()).toContain('9007199254740993');
	});

	it.each([
		{ scenario: 'ready', statuses: [200, 200] },
		{ scenario: 'stale-incomplete', statuses: [503, 200] },
		{ scenario: 'unavailable', statuses: [503, 503] }
	])(
		'retains actual route $scenario statuses, exact strings and unknown nulls',
		({ scenario, statuses }) => {
			const selected = fixtures.filter((row) => row.scenario === scenario);
			expect(selected.map((row) => row.status)).toEqual(statuses);
			const metrics = selected.find((row) =>
				row.path.endsWith('/metrics')
			)!.body;
			expect(metrics.publication?.records).toBe(
				scenario === 'unavailable' ? null : '9007199254740993'
			);
			expect(metrics.archives?.checkedRoots).toBe(
				scenario === 'ready' ? 2 : null
			);
			if (scenario === 'stale-incomplete')
				expect(metrics.archives?.complete).toBe(false);
			if (scenario === 'unavailable')
				expect(metrics.archives?.knownRoots).toBeNull();
		}
	);

	it('links both actual generated reference operations', () => {
		const spec = JSON.parse(
			readFileSync(
				new URL('../../../../generated/public-openapi.json', import.meta.url),
				'utf8'
			)
		) as {
			paths: Record<string, { get: { operationId: string } }>;
		};
		for (const kind of ['health', 'metrics']) {
			const operation = spec.paths['/v1/public-goods/' + kind]!.get.operationId;
			expect(renderSection()).toContain('href="/docs/api/' + operation + '"');
		}
		expect(renderSection()).toContain('href="/docs/querying"');
	});

	it('distinguishes availability, coverage, inventory and root verification', () => {
		const html = renderSection();
		for (const text of [
			'both metric sources were read',
			'Keep null distinct from zero',
			'not a readiness certificate',
			'not unique transactions',
			'including failed observations',
			'not fully verified archive histories',
			'not verification of every checkpoint',
			'complete and untruncated',
			'not whether chain history is complete',
			'JavaScript Number can round',
			'local timeout can leave an incomplete file'
		])
			expect(html).toContain(text);
		expect(html).toContain('<thead>');
		expect(blocks()).toHaveLength(4);
	});
});
