import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { graphqlErrorExample } from '../graphql-error-example';
import { graphqlAnalyticsExamples } from '../graphql-analytics-examples';

interface MeasuredCase {
	readonly case: string;
	readonly request: { readonly accept: string };
	readonly response: { readonly status: number; readonly body: unknown };
}
interface RunInput {
	readonly status?: number;
	readonly body?: unknown;
	readonly text?: string;
	readonly failure?: 'network' | 'deadline' | 'body';
}
interface Output {
	readonly kind: 'log' | 'warn' | 'error';
	readonly values: readonly unknown[];
}
const measured = JSON.parse(
	readFileSync(
		new URL(
			'../../../../../../docs/sdk-contracts/fixtures/http-negotiation.json',
			import.meta.url
		),
		'utf8'
	)
) as readonly MeasuredCase[];

async function runExample(input: RunInput) {
	const output: Output[] = [];
	const calls: { url: string; options: RequestInit }[] = [];
	let deadline: (() => void) | undefined;
	let milliseconds = 0;
	let cleared = 0;
	const record =
		(kind: Output['kind']) =>
		(...values: unknown[]) =>
			output.push({ kind, values });
	const script = new Script(
		'(async () => {\n' + graphqlErrorExample + '\n})()'
	);
	(await script.runInNewContext({
		AbortController,
		JSON,
		Error,
		console: {
			log: record('log'),
			warn: record('warn'),
			error: record('error')
		},
		setTimeout(callback: () => void, delay: number) {
			deadline = callback;
			milliseconds = delay;
			return 1;
		},
		clearTimeout(id: number) {
			expect(id).toBe(1);
			cleared++;
		},
		fetch: async (url: string, options: RequestInit) => {
			calls.push({ url, options });
			if (input.failure === 'deadline') {
				deadline?.();
				throw new Error('Synthetic abort');
			}
			if (input.failure === 'network')
				throw new TypeError('Synthetic network failure');
			const status = input.status ?? 200;
			return {
				status,
				ok: status >= 200 && status < 300,
				text: async () => {
					if (input.failure === 'body')
						throw new Error('Synthetic body read failure');
					return input.text ?? JSON.stringify(input.body);
				}
			};
		}
	})) as unknown;
	expect(calls).toHaveLength(1);
	expect(milliseconds).toBe(10_000);
	expect(cleared).toBe(1);
	expect(calls[0]!.url).toBe('https://api.stellaratlas.io/graphql');
	expect(calls[0]!.options.headers).toMatchObject({
		'Content-Type': 'application/json',
		Accept: 'application/graphql-response+json'
	});
	expect(JSON.parse(String(calls[0]!.options.body))).toEqual({
		query: graphqlAnalyticsExamples.operations.query,
		variables: graphqlAnalyticsExamples.operations.variables
	});
	return { output, calls };
}

describe('published one-attempt GraphQL request example', () => {
	it.each(
		measured.filter(
			(row) => !['success', 'unsupported-accept'].includes(row.case)
		)
	)(
		'displays measured $case error body from $request.accept at HTTP$response.status',
		async (row) => {
			const text = JSON.stringify(row.response.body);
			const { output } = await runExample({
				status: row.response.status,
				text
			});
			expect(output.filter((item) => item.kind === 'log')).toEqual([]);
			expect(output.find((item) => item.kind === 'error')?.values).toEqual([
				'GraphQL errors (HTTP ' + row.response.status + '):',
				text
			]);
		}
	);
	it('keeps large exact strings and numeric literals in the original response text', async () => {
		const text =
			'{"data":{"hubbleOperations":{"rows":[{"id":"9007199254740993","details":{"literal":9007199254740993,"raw":"9223372036854775807"}}],"nextOffset":null}}}';
		const { output } = await runExample({ text });
		expect(output).toEqual([
			{ kind: 'log', values: ['Operation response JSON:', text] }
		]);
	});
	it('accepts a complete empty page without treating it as failure or current-chain absence', async () => {
		const body = { data: { hubbleOperations: { rows: [], nextOffset: null } } };
		const { output } = await runExample({ body });
		expect(output).toEqual([
			{
				kind: 'log',
				values: ['Operation response JSON:', JSON.stringify(body)]
			}
		]);
	});
	it.each([200, 400])(
		'keeps partial data out of the complete page branch at HTTP%i',
		async (status) => {
			const body = {
				errors: [{ message: 'Synthetic partial result' }],
				data: {
					hubbleOperations: {
						rows: [{ id: '9007199254740993' }],
						nextOffset: 10
					}
				}
			};
			const { output } = await runExample({ status, body });
			expect(output.some((item) => item.kind === 'log')).toBe(false);
			expect(
				output.some(
					(item) =>
						item.kind === 'warn' &&
						String(item.values[0]).includes('do not advance pagination')
				)
			).toBe(true);
		}
	);
	it.each(['network', 'deadline', 'body'] as const)(
		'distinguishes %s failure without retrying',
		async (failure) => {
			const { output } = await runExample({ failure });
			const expected =
				failure === 'network'
					? 'No HTTP response'
					: failure === 'deadline'
						? 'Request deadline exceeded'
						: 'Response handling failed';
			expect(
				String(output.find((item) => item.kind === 'error')?.values[0])
			).toContain(expected);
			expect(output.some((item) => item.kind === 'log')).toBe(false);
		}
	);
	it('reports a non-JSON HTTP failure without inventing a GraphQL code', async () => {
		const { output } = await runExample({ status: 406, text: '' });
		expect(output).toEqual([
			{ kind: 'error', values: ['HTTP 406 without GraphQL errors:', ''] }
		]);
	});
	it.each([
		{ body: { data: null } },
		{ body: { errors: { message: 'Not an array' } } },
		{ body: ['Not an object'] }
	])('rejects an invalid successful response shape %#', async ({ body }) => {
		const { output } = await runExample({ body });
		expect(
			String(output.find((item) => item.kind === 'error')?.values[0])
		).toContain('Response handling failed');
		expect(output.some((item) => item.kind === 'log')).toBe(false);
	});
});
