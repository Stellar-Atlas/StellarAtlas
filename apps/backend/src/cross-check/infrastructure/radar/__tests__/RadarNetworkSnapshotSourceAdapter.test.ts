import {
	RadarNetworkSnapshotSourceAdapter,
	type RadarNetworkSnapshotFetch
} from '../RadarNetworkSnapshotSourceAdapter.js';

describe('RadarNetworkSnapshotSourceAdapter', () => {
	it('should fetch and parse a bounded RADAR network snapshot', async () => {
		let observedRequest:
			{ input: string | URL; init?: RequestInit } | undefined;
		const fetchFn: RadarNetworkSnapshotFetch = async (input, init) => {
			observedRequest = { input, init };
			return new Response(JSON.stringify(createNetworkSnapshot()), {
				status: 200
			});
		};
		const adapter = new RadarNetworkSnapshotSourceAdapter(
			fetchFn,
			() => new Date('2026-07-03T14:00:00.000Z')
		);

		const result = await adapter.fetchNetworkSnapshot({ timeoutMs: 250 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			endpointUrl: 'https://radar.withobsrvr.com/api/v1',
			fetchedAt: '2026-07-03T14:00:00.000Z',
			latestLedger: '63311161',
			networkId: 'public',
			networkName: 'Public Stellar Network',
			networkTime: '2026-07-03T13:59:00.000Z',
			sourceId: 'withobsrvr-radar',
			warnings: []
		});
		expect(result.value.contentHashSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(result.value.nodes).toEqual([
			{
				active: true,
				activeInScp: true,
				alias: 'validator-a',
				connectivityError: false,
				historyArchiveHasError: true,
				historyUrl: 'https://history.example.com',
				homeDomain: 'example.com',
				host: 'validator.example.com',
				index: 7,
				isFullValidator: true,
				isValidating: true,
				isValidator: true,
				lag: 3,
				name: 'Validator A',
				organizationId: 'org-1',
				publicKey: 'GVALIDATORA',
				quorumSetHashKey: 'hash-a',
				stellarCoreVersionBehind: false,
				versionStr: '25.0.0'
			}
		]);
		expect(result.value.organizations).toEqual([
			{
				homeDomain: 'example.com',
				horizonUrl: 'https://horizon.example.com',
				id: 'org-1',
				name: 'Example Org',
				tomlState: 'Ok',
				url: 'https://example.com',
				validators: ['GVALIDATORA']
			}
		]);
		expect(observedRequest?.input).toBe('https://radar.withobsrvr.com/api/v1');
		expect(observedRequest?.init?.headers).toEqual({
			accept: 'application/json'
		});
		expect(observedRequest?.init?.signal).toBeInstanceOf(AbortSignal);
	});

	it('should skip invalid rows and preserve parser warnings', async () => {
		const fetchFn: RadarNetworkSnapshotFetch = async () =>
			new Response(
				JSON.stringify({
					...createNetworkSnapshot(),
					nodes: [{ publicKey: 'GVALIDATORA' }, { name: 'missing key' }],
					organizations: [{ id: 'org-1' }, { name: 'missing id' }]
				}),
				{ status: 200 }
			);
		const adapter = new RadarNetworkSnapshotSourceAdapter(fetchFn);

		const result = await adapter.fetchNetworkSnapshot();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.nodes).toHaveLength(1);
		expect(result.value.organizations).toHaveLength(1);
		expect(result.value.warnings).toEqual([
			'Skipped RADAR node at index 1: missing publicKey',
			'Skipped RADAR organization at index 1: missing id'
		]);
	});

	it('should return an error for non-successful RADAR responses', async () => {
		const fetchFn: RadarNetworkSnapshotFetch = async () =>
			new Response('unavailable', { status: 503 });
		const adapter = new RadarNetworkSnapshotSourceAdapter(fetchFn);

		const result = await adapter.fetchNetworkSnapshot();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			kind: 'http_status',
			message: 'RADAR network snapshot returned HTTP 503',
			status: 503
		});
	});

	it('should reject responses that exceed the configured byte cap', async () => {
		const fetchFn: RadarNetworkSnapshotFetch = async () =>
			new Response(JSON.stringify(createNetworkSnapshot()), { status: 200 });
		const adapter = new RadarNetworkSnapshotSourceAdapter(fetchFn);

		const result = await adapter.fetchNetworkSnapshot({ maxBytes: 10 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			kind: 'max_bytes_exceeded',
			limitBytes: 10,
			message: 'RADAR network snapshot response exceeded 10 bytes'
		});
	});

	it('should reject invalid JSON and missing payload arrays', async () => {
		const invalidJson = new RadarNetworkSnapshotSourceAdapter(
			async () => new Response('{bad json', { status: 200 })
		);
		const missingArrays = new RadarNetworkSnapshotSourceAdapter(
			async () => new Response(JSON.stringify({ nodes: [] }), { status: 200 })
		);

		const invalidJsonResult = await invalidJson.fetchNetworkSnapshot();
		const missingArraysResult = await missingArrays.fetchNetworkSnapshot();

		expect(invalidJsonResult.isErr()).toBe(true);
		expect(invalidJsonResult._unsafeUnwrapErr().kind).toBe('invalid_json');
		expect(missingArraysResult.isErr()).toBe(true);
		expect(missingArraysResult._unsafeUnwrapErr()).toMatchObject({
			kind: 'invalid_payload',
			message: 'RADAR network snapshot is missing nodes or organizations'
		});
	});

	it('should map fetch failures into Result errors', async () => {
		const fetchFn: RadarNetworkSnapshotFetch = async () => {
			throw new Error('network unavailable');
		};
		const adapter = new RadarNetworkSnapshotSourceAdapter(fetchFn);

		const result = await adapter.fetchNetworkSnapshot();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toEqual({
			kind: 'network_error',
			message: 'network unavailable'
		});
	});
});

function createNetworkSnapshot(): Record<string, unknown> {
	return {
		id: 'public',
		name: 'Public Stellar Network',
		time: '2026-07-03T13:59:00.000Z',
		latestLedger: '63311161',
		nodes: [
			{
				active: true,
				activeInScp: true,
				alias: 'validator-a',
				connectivityError: false,
				historyArchiveHasError: true,
				historyUrl: 'https://history.example.com',
				homeDomain: 'example.com',
				host: 'validator.example.com',
				index: 7,
				isFullValidator: true,
				isValidating: true,
				isValidator: true,
				lag: 3,
				name: 'Validator A',
				organizationId: 'org-1',
				publicKey: 'GVALIDATORA',
				quorumSetHashKey: 'hash-a',
				stellarCoreVersionBehind: false,
				versionStr: '25.0.0'
			}
		],
		organizations: [
			{
				homeDomain: 'example.com',
				horizonUrl: 'https://horizon.example.com',
				id: 'org-1',
				name: 'Example Org',
				tomlState: 'Ok',
				url: 'https://example.com',
				validators: ['GVALIDATORA', 1]
			}
		]
	};
}
