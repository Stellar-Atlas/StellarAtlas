import assert from 'node:assert/strict';
import test from 'node:test';
import {
	verifyAnalyticsTransaction,
	validateDetail
} from './analytics-transaction-smoke.mjs';
const hash = 'a'.repeat(64),
	ledger = 63490364;
function detail() {
	return {
		transaction: { hash, ledgerSequence: ledger, operationCount: 1 },
		operations: { items: [{ id: 'op1', ledgerSequence: ledger }] },
		effects: { items: [] },
		events: {
			items: [
				{
					id: 'event1',
					ledgerSequence: ledger,
					classification: {
						transactionKind: 'soroban',
						eventKind: 'diagnostic',
						sorobanExecutionEvidence: true,
						provenance: 'complete'
					}
				}
			]
		}
	};
}
test('release smoke makes exactly two sequential hash-only requests and validates their parsed data', async () => {
	const requests = [];
	const result = await verifyAnalyticsTransaction({
		baseUrl: 'https://example.test',
		hash,
		ledger,
		fetchImpl: async (url, options) => {
			requests.push({ url, options });
			return new Response(
				JSON.stringify(
					requests.length === 1
						? detail()
						: {
								data: { hubbleTransaction: detail() }
							}
				),
				{ status: 200 }
			);
		}
	});
	assert.equal(result.checks.length, 2);
	assert.equal(requests[1].url.pathname, '/graphql');
	assert.equal(requests[0].url.searchParams.has('ledger_sequence'), false);
	const graphql = JSON.parse(requests[1].options.body);
	assert.deepEqual(graphql.variables, { hash });
	assert.doesNotMatch(graphql.query, /ledgerSequence:/);
	assert.equal(requests[0].options.credentials, 'omit');
	assert.ok(
		requests.every((request) => request.options.signal instanceof AbortSignal)
	);
});
test('HTTP-200 HTML or a legacy transaction summary cannot pass', () => {
	assert.throws(() => validateDetail('<html>ok</html>', hash, ledger));
	assert.throws(() => validateDetail({ hash, ledger }, hash, ledger));
});
test('wrong transaction or relationship ledger cannot pass', () => {
	const wrong = detail();
	wrong.transaction.hash = 'b'.repeat(64);
	assert.throws(() => validateDetail(wrong, hash, ledger));
	const relation = detail();
	relation.events.items[0].ledgerSequence++;
	assert.throws(() => validateDetail(relation, hash, ledger));
});
test('missing decoded operations and missing event provenance cannot pass', () => {
	const empty = detail();
	empty.operations.items = [];
	assert.throws(() => validateDetail(empty, hash, ledger));
	const event = detail();
	delete event.events.items[0].classification;
	assert.throws(() => validateDetail(event, hash, ledger));
});
test('GraphQL HTTP-200 errors are failures', async () => {
	let calls = 0;
	await assert.rejects(
		verifyAnalyticsTransaction({
			baseUrl: 'https://example.test',
			hash,
			ledger,
			fetchImpl: async () =>
				new Response(
					JSON.stringify(
						++calls === 1
							? detail()
							: {
									errors: [{ message: 'Query timed out' }]
								}
					),
					{ status: 200 }
				)
		}),
		/GraphQL errors/
	);
});
test('timeouts and HTTP failures are not accepted or retried in a loop', async () => {
	let calls = 0;
	await assert.rejects(
		verifyAnalyticsTransaction({
			baseUrl: 'https://example.test',
			hash,
			ledger,
			fetchImpl: async () => {
				calls++;
				throw new DOMException('Timeout', 'TimeoutError');
			}
		}),
		/Timeout/
	);
	assert.equal(calls, 1);
	await assert.rejects(
		verifyAnalyticsTransaction({
			baseUrl: 'https://example.test',
			hash,
			ledger,
			fetchImpl: async () => new Response('{}', { status: 503 })
		}),
		/HTTP 200/
	);
});
test('REST and GraphQL must return the same relationship identities', async () => {
	let calls = 0;
	const other = detail();
	other.events.items[0].id = 'wrong-event';
	await assert.rejects(
		verifyAnalyticsTransaction({
			baseUrl: 'https://example.test',
			hash,
			ledger,
			fetchImpl: async () =>
				new Response(
					JSON.stringify(
						++calls === 1
							? detail()
							: {
									data: { hubbleTransaction: other }
								}
					),
					{ status: 200 }
				)
		}),
		/events must agree/
	);
});
