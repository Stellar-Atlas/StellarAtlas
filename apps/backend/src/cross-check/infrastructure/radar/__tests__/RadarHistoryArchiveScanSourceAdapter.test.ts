import {
	RadarHistoryArchiveScanSourceAdapter,
	type RadarHistoryArchiveScanFetch
} from '../RadarHistoryArchiveScanSourceAdapter.js';

describe('RadarHistoryArchiveScanSourceAdapter', () => {
	it('should fetch and parse a bounded RADAR history archive scan', async () => {
		let observedRequest:
			{ input: string | URL; init?: RequestInit } | undefined;
		const fetchFn: RadarHistoryArchiveScanFetch = async (input, init) => {
			observedRequest = { input, init };
			return new Response(JSON.stringify(createHistoryArchiveScan()), {
				status: 200
			});
		};
		const adapter = new RadarHistoryArchiveScanSourceAdapter(
			fetchFn,
			() => new Date('2026-07-03T14:00:00.000Z')
		);

		const result = await adapter.fetchHistoryArchiveScan(
			'https://history.example.com',
			{ timeoutMs: 250 }
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			endDate: '2026-07-03T13:05:00.000Z',
			errorMessage: 'Wrong ledger hash',
			errorUrl: 'https://history.example.com/ledger.xdr.gz',
			fetchedAt: '2026-07-03T14:00:00.000Z',
			hasError: true,
			isSlow: false,
			latestVerifiedLedger: 127,
			sourceId: 'withobsrvr-radar',
			startDate: '2026-07-03T13:00:00.000Z',
			url: 'https://history.example.com'
		});
		expect(result.value?.contentHashSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(observedRequest?.input).toBe(
			'https://radar.withobsrvr.com/api/v1/history-scan/https%3A%2F%2Fhistory.example.com'
		);
		expect(observedRequest?.init?.headers).toEqual({
			accept: 'application/json'
		});
		expect(observedRequest?.init?.signal).toBeInstanceOf(AbortSignal);
	});

	it('should normalize archive URLs before encoding them for RADAR', async () => {
		let observedInput: string | URL | undefined;
		const adapter = new RadarHistoryArchiveScanSourceAdapter(async (input) => {
			observedInput = input;
			return new Response(JSON.stringify(createHistoryArchiveScan()), {
				status: 200
			});
		});

		const result = await adapter.fetchHistoryArchiveScan(
			'https://history.example.com/'
		);

		expect(result.isOk()).toBe(true);
		expect(observedInput).toBe(
			'https://radar.withobsrvr.com/api/v1/history-scan/https%3A%2F%2Fhistory.example.com'
		);
	});

	it('should return null when RADAR has no scan for the archive URL', async () => {
		const adapter = new RadarHistoryArchiveScanSourceAdapter(
			async () => new Response('not found', { status: 404 })
		);

		const result = await adapter.fetchHistoryArchiveScan(
			'https://history.example.com'
		);

		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('should return an error for non-404 unsuccessful RADAR responses', async () => {
		const adapter = new RadarHistoryArchiveScanSourceAdapter(
			async () => new Response('unavailable', { status: 503 })
		);

		const result = await adapter.fetchHistoryArchiveScan(
			'https://history.example.com'
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			kind: 'http_status',
			message: 'RADAR history archive scan returned HTTP 503',
			status: 503
		});
	});

	it('should reject invalid archive URLs before fetching', async () => {
		const fetchFn = jest.fn<RadarHistoryArchiveScanFetch>();
		const adapter = new RadarHistoryArchiveScanSourceAdapter(fetchFn);

		const result = await adapter.fetchHistoryArchiveScan('   ');

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toEqual({
			kind: 'invalid_archive_url',
			message: 'RADAR history archive scan requires a valid archive URL'
		});
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('should reject responses that exceed the configured byte cap', async () => {
		const adapter = new RadarHistoryArchiveScanSourceAdapter(
			async () => new Response(JSON.stringify(createHistoryArchiveScan()))
		);

		const result = await adapter.fetchHistoryArchiveScan(
			'https://history.example.com',
			{ maxBytes: 10 }
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			kind: 'max_bytes_exceeded',
			limitBytes: 10,
			message: 'RADAR history archive scan response exceeded 10 bytes'
		});
	});

	it('should reject invalid JSON and missing required fields', async () => {
		const invalidJson = new RadarHistoryArchiveScanSourceAdapter(
			async () => new Response('{bad json', { status: 200 })
		);
		const missingFields = new RadarHistoryArchiveScanSourceAdapter(
			async () =>
				new Response(JSON.stringify({ url: 'https://history.example.com' }), {
					status: 200
				})
		);

		const invalidJsonResult = await invalidJson.fetchHistoryArchiveScan(
			'https://history.example.com'
		);
		const missingFieldsResult = await missingFields.fetchHistoryArchiveScan(
			'https://history.example.com'
		);

		expect(invalidJsonResult.isErr()).toBe(true);
		expect(invalidJsonResult._unsafeUnwrapErr().kind).toBe('invalid_json');
		expect(missingFieldsResult.isErr()).toBe(true);
		expect(missingFieldsResult._unsafeUnwrapErr()).toMatchObject({
			kind: 'invalid_payload',
			message: 'RADAR history archive scan is missing required fields'
		});
	});

	it('should map fetch failures into Result errors', async () => {
		const adapter = new RadarHistoryArchiveScanSourceAdapter(async () => {
			throw new Error('network unavailable');
		});

		const result = await adapter.fetchHistoryArchiveScan(
			'https://history.example.com'
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toEqual({
			kind: 'network_error',
			message: 'network unavailable'
		});
	});
});

function createHistoryArchiveScan(): Record<string, unknown> {
	return {
		endDate: '2026-07-03T13:05:00.000Z',
		errorMessage: 'Wrong ledger hash',
		errorUrl: 'https://history.example.com/ledger.xdr.gz',
		hasError: true,
		isSlow: false,
		latestVerifiedLedger: 127,
		startDate: '2026-07-03T13:00:00.000Z',
		url: 'https://history.example.com'
	};
}
