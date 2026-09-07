import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Opt-in release check: two sequential, bounded queries for an already-ingested fixture.
// No ledger hint is sent: a fast hinted request does not prove hash-only lookup works.
export async function verifyAnalyticsTransaction({
	baseUrl,
	hash,
	ledger,
	fetchImpl = fetch,
	timeoutMs = 20000
}) {
	assert.match(hash, /^[a-f0-9]{64}$/i, 'Expected a transaction hash');
	assert.ok(
		Number.isSafeInteger(ledger) && ledger >= 2,
		'Expected its known ledger'
	);
	const base = new URL(baseUrl);
	assert.ok(['http:', 'https:'].includes(base.protocol), 'Expected HTTP(S)');
	assert.ok(
		!base.username && !base.password,
		'Do not put credentials in the URL'
	);
	const reports = [];
	async function request(path, options = {}) {
		const started = performance.now();
		const response = await fetchImpl(new URL(path, base), {
			...options,
			credentials: 'omit',
			headers: { accept: 'application/json', ...options.headers },
			signal: AbortSignal.timeout(timeoutMs)
		});
		assert.equal(response.status, 200, path + ' must return HTTP 200');
		const body = await response.json();
		reports.push({
			path,
			milliseconds: Math.round(performance.now() - started)
		});
		return body;
	}
	const rest = await request(
		'/v1/analytics/transactions/' + hash + '?view=typed&limit=2'
	);
	validateDetail(rest, hash, ledger);
	const graphql = await request('/v1/analytics/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			query: `query TransactionReleaseCheck($hash: String!) {
    hubbleTransaction(transactionHash: $hash, limit: 2) {
     transaction { hash ledgerSequence operationCount }
     operations { items { id ledgerSequence } }
     effects { items { id ledgerSequence } }
     events { items { id ledgerSequence classification {
      transactionKind eventKind sorobanExecutionEvidence provenance
     } } }
    }
   }`,
			variables: { hash }
		})
	});
	assert.ok(
		!graphql.errors?.length,
		'GraphQL errors: ' + JSON.stringify(graphql.errors)
	);
	validateDetail(graphql.data?.hubbleTransaction, hash, ledger);
	for (const relation of ['operations', 'effects', 'events']) {
		assert.deepEqual(
			graphql.data.hubbleTransaction[relation].items.map((row) => row.id),
			rest[relation].items.map((row) => row.id),
			relation + ' must agree between REST and GraphQL'
		);
	}
	return { hash, ledger, checks: reports };
}
export function validateDetail(detail, hash, ledger) {
	assert.ok(
		detail?.transaction,
		'Response must contain parsed transaction detail'
	);
	assert.equal(detail.transaction.hash, hash);
	assert.equal(detail.transaction.ledgerSequence, ledger);
	for (const relation of ['operations', 'effects', 'events']) {
		assert.ok(
			Array.isArray(detail[relation]?.items),
			'Missing ' + relation + ' page'
		);
		assert.ok(detail[relation].items.length <= 2, 'Page limit not respected');
		for (const row of detail[relation].items) {
			assert.equal(
				row.ledgerSequence,
				ledger,
				relation + ' belongs to another ledger'
			);
			assert.ok(
				typeof row.id === 'string' && row.id.length,
				'Missing relationship identity'
			);
			if (relation === 'events') {
				assert.ok(
					['classic', 'soroban', 'unknown'].includes(
						row.classification?.transactionKind
					),
					'Missing event transaction provenance'
				);
				assert.equal(
					typeof row.classification?.sorobanExecutionEvidence,
					'boolean'
				);
			}
		}
	}
	if (detail.transaction.operationCount > 0)
		assert.ok(
			detail.operations.items.length,
			'Non-empty transaction has no decoded operations'
		);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const [baseUrl, hash, ledgerText] = process.argv.slice(2);
	if (!baseUrl || !hash || !ledgerText) {
		throw new Error(
			'Usage: node scripts/analytics-transaction-smoke.mjs BASE_URL HASH LEDGER'
		);
	}
	console.log(
		JSON.stringify(
			await verifyAnalyticsTransaction({
				baseUrl,
				hash,
				ledger: Number(ledgerText)
			})
		)
	);
}
