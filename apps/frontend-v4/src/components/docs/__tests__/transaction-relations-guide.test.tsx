import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getDeveloperGuidePage } from '../developer-guide-content';
import excerpts from '../transaction-guide-excerpts.json' with { type: 'json' };
import { graphqlExamples } from '../graphql-request';

interface Page {
	transaction: {
		id: string;
		hash: string;
		sequence: string;
		ledgerSequence: number;
		feeChargedRaw: string;
	};
	operations: {
		items: { id: string; amounts: { raw: string }[] }[];
		limit: number;
		nextCursor: string | null;
	};
	effects: {
		items: { id: string; operationId: string }[];
		limit: number;
		nextCursor: string | null;
	};
	events: {
		items: { id: string; contractId: string }[];
		limit: number;
		nextCursor: string | null;
	};
}
interface Contract<T = Page> {
	rest: { request: { path: string }; response: { status: number; body: T } };
}
const fixture = <T = Page,>(name: string): Contract<T> =>
	JSON.parse(
		readFileSync(
			new URL(
				'../../../../../../docs/sdk-contracts/fixtures/transaction-' +
					name +
					'.json',
				import.meta.url
			),
			'utf8'
		)
	) as Contract<T>;
const first = fixture('first'),
	continued = fixture('continued'),
	terminal = fixture('terminal');
const wrong = fixture<{ code: string; error: string }>('cursor-wrong-relation');
const relations = ['operations', 'effects', 'events'] as const;
function html(): string {
	const section = getDeveloperGuidePage('rest')?.sections.find(
		(s) => s.id === 'transaction-relations'
	);
	if (!section) throw new Error('Missing transaction journey');
	return renderToStaticMarkup(createElement(Fragment, null, section.content));
}
const blocks = () =>
	[...html().matchAll(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code>/g)].map(
		(match) => match[1]
	);
const escaped = (text: string) =>
	renderToStaticMarkup(createElement('code', null, text)).slice(6, -7);

describe('typed transaction guide', () => {
	it('starts from a selected operation hash/known ledger and preserves bounded request/file options', () => {
		const code = blocks()[0]!;
		for (const text of [
			'.rows[0].transactionHash // empty',
			'.rows[0].ledgerSequence // empty',
			'limit=1',
			'--fail-with-body --connect-timeout 5 --max-time 30 --get',
			'https://api.stellaratlas.io/v1/analytics/transactions/',
			'"$hash"',
			"'view=typed'",
			'"ledger_sequence=$ledger"',
			'"limit=$limit"',
			'--output transaction-page-1.json'
		])
			expect(code).toContain(escaped(text));
		expect(code).not.toContain('--retry');
		expect(code).not.toContain(first.rest.response.body.transaction.hash);
	});

	it.each(relations)(
		'renders only the matching %s cursor and destination',
		(relation) => {
			const index = relations.indexOf(relation);
			const code = blocks()[index + 2]!;
			expect(code).toContain(
				escaped(
					`after=$(jq -er '.${relation}.nextCursor // empty' transaction-page-1.json) &&`
				)
			);
			expect(code).toContain(
				escaped(`--data-urlencode "${relation}_after=$after"`)
			);
			expect(code).toContain(`--output transaction-${relation}-page-2.json`);
			expect(code).toContain(escaped('"ledger_sequence=$ledger"'));
			expect(code).toContain(escaped('"limit=$limit"'));
			for (const other of relations.filter((value) => value !== relation))
				expect(code).not.toContain(other + '_after=');
			const request = new URL(
				continued.rest.request.path,
				'https://fixture.invalid'
			);
			expect(request.searchParams.get(relation + '_after')).toBe(
				first.rest.response.body[relation].nextCursor
			);
		}
	);

	it('projects only real first-page fixture fields while keeping exact strings', () => {
		expect(first.rest.response.body.transaction).toMatchObject(
			excerpts.first.transaction
		);
		expect(excerpts.first.transaction).toMatchObject({
			id: first.rest.response.body.transaction.id,
			hash: first.rest.response.body.transaction.hash,
			sequence: '9007199254740993',
			ledgerSequence: first.rest.response.body.transaction.ledgerSequence,
			feeChargedRaw: first.rest.response.body.transaction.feeChargedRaw
		});
		for (const relation of relations) {
			expect(excerpts.first[relation].limit).toBe(
				first.rest.response.body[relation].limit
			);
			expect(excerpts.first[relation].items).toHaveLength(
				first.rest.response.body[relation].items.length
			);
			excerpts.first[relation].items.forEach((item, index) =>
				expect(first.rest.response.body[relation].items[index]).toMatchObject(
					item
				)
			);
		}
		expect(excerpts.first.operations.items[0]!.amounts[0]!.raw).toBe(
			'9007199254740993'
		);
		expect(blocks()[1]).toBe(escaped(JSON.stringify(excerpts.first, null, 2)));
	});

	it('uses the actual reviewed wrong-relation error and terminal cursors', () => {
		expect(wrong.rest.response.status).toBe(400);
		expect(excerpts.wrongRelation).toEqual(wrong.rest.response);
		expect(excerpts.wrongRelation.body.code).toBe('invalid_hubble_query');
		expect(blocks()[5]).toBe(
			escaped(JSON.stringify(wrong.rest.response.body, null, 2))
		);
		for (const relation of relations) {
			expect(first.rest.response.body[relation].nextCursor).toEqual(
				expect.any(String)
			);
			expect(terminal.rest.response.body[relation].nextCursor).toBeNull();
		}
	});

	it('explains independent advancement, coverage and exactness without a live-data promise', () => {
		for (const text of [
			'does not advance the other two relations',
			'returns their initial pages again',
			'consume only the intended relation',
			'without decoding them',
			'not proof of complete chain history',
			'No sample hash',
			'not a live record',
			'lossless decoder',
			'without automatic retries',
			'observedAt'
		])
			expect(html()).toContain(text);
		expect(html()).toContain('href="/docs/api/getAnalyticsTransaction"');
		expect(html()).toContain('href="/docs/graphql"');
		expect(html()).toContain(graphqlExamples.transaction.label);
		expect(html()).toContain('operationsAfter');
		expect(html()).toContain('effectsAfter');
		expect(html()).toContain('eventsAfter');
		const quickstart = getDeveloperGuidePage('quickstart')!;
		expect(
			renderToStaticMarkup(
				createElement(
					Fragment,
					null,
					...quickstart.sections.map((s) => s.content)
				)
			)
		).toContain('href="/docs/rest#transaction-relations"');
		expect(blocks()).toHaveLength(6);
	});
});
