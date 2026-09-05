import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';

// Optional real-engine check: reads inline VALUES only, never warehouse tables.
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;

engineTest('Hubble batch visibility on ClickHouse', () => {
	it('hides failed/in-flight/orphan rows, honors retries, and matches the latest digest', async () => {
		const predicate = completedHubbleBatchPredicate('fixture').replace(
			'`fixture`._ingestion_batches',
			'batch_fixture'
		);
		const query = `
WITH batch_fixture AS (
 SELECT * FROM values(
  'batch_id UInt64, source_sha256 String, status String, updated_at UInt64',
  (1, 'a', 'complete', 1),
  (2, 'a', 'failed', 1),
  (3, 'a', 'started', 1),
  (4, 'a', 'complete', 1), (4, 'a', 'failed', 2),
  (5, 'a', 'complete', 1), (5, 'a', 'started', 2),
  (6, 'a', 'failed', 1), (6, 'a', 'started', 2), (6, 'a', 'complete', 3),
  (8, 'old', 'complete', 1), (8, 'new', 'complete', 2)
 )
)
SELECT _batch_id, _source_sha256 FROM values(
 '_batch_id UInt64, _source_sha256 String',
 (1, 'a'), (2, 'a'), (3, 'a'), (4, 'a'), (5, 'a'),
 (6, 'a'), (7, 'a'), (8, 'old'), (8, 'new')
)
WHERE ${predicate}
ORDER BY _batch_id
FORMAT JSON`;
		const url = new URL(endpoint!);
		url.searchParams.set('query', query);
		const headers: Record<string, string> = {};
		const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
		if (user)
			headers.Authorization =
				'Basic ' +
				Buffer.from(
					user + ':' + (process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
				).toString('base64');
		const response = await fetch(url, {
			method: 'POST',
			headers,
			signal: AbortSignal.timeout(10_000)
		});
		expect(response.status).toBe(200);
		const result = (await response.json()) as {
			data: { _batch_id: string | number; _source_sha256: string }[];
		};
		expect(
			result.data.map((row) => ({ ...row, _batch_id: String(row._batch_id) }))
		).toEqual([
			{ _batch_id: '1', _source_sha256: 'a' },
			{ _batch_id: '6', _source_sha256: 'a' },
			{ _batch_id: '8', _source_sha256: 'new' }
		]);
	});
});
