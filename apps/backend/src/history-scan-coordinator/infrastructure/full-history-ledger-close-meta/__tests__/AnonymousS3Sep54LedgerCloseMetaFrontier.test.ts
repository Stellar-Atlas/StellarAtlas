import type { Sep54LedgerCloseMetaConfig } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import {
	AnonymousS3Sep54LedgerCloseMetaFrontier,
	type AnonymousS3ListObjectsClient,
	type AnonymousS3ListObjectsRequest,
	type AnonymousS3ListObjectsResult
} from '../AnonymousS3Sep54LedgerCloseMetaFrontier.js';

describe('AnonymousS3Sep54LedgerCloseMetaFrontier', () => {
	it('uses reverse-key listing to find the newest valid source batch', async () => {
		const client = new FixtureListClient([
			{
				keys: [
					`${LEDGERS_PATH}/.config.json`,
					`${LEDGERS_PATH}/FC3839FF--63424000-63487999/FC378876--63469449.xdr.zst`,
					`${LEDGERS_PATH}/FC3839FF--63424000-63487999/FC378877--63469448.xdr.zst`
				]
			}
		]);
		const frontier = createFrontier(client);

		await expect(
			frontier.readLatestRange(CONFIG, new AbortController().signal)
		).resolves.toEqual({
			endSequence: 63_469_449,
			ledgerCount: 1,
			startSequence: 63_469_449
		});
		expect(client.requests).toEqual([
			expect.objectContaining({
				bucket: 'aws-public-blockchain',
				maximumKeys: 32,
				prefix: `${LEDGERS_PATH}/`
			})
		]);
	});

	it('continues past a config-only page using a bounded continuation token', async () => {
		const client = new FixtureListClient([
			{
				keys: [`${LEDGERS_PATH}/.config.json`],
				nextContinuationToken: 'next-page'
			},
			{
				keys: [`${LEDGERS_PATH}/FFFFFFFF--0-63999/FFFFFFFC--3.xdr.zst`]
			}
		]);
		await createFrontier(client).readLatestRange(
			CONFIG,
			new AbortController().signal
		);
		expect(client.requests[1]?.continuationToken).toBe('next-page');
	});

	it('rejects malformed listed ledger keys rather than guessing a frontier', async () => {
		const client = new FixtureListClient([
			{
				keys: [`${LEDGERS_PATH}/FFFFFFFF--0-63999/FFFFFFFF--3.xdr.zst`]
			}
		]);
		await expect(
			createFrontier(client).readLatestRange(
				CONFIG,
				new AbortController().signal
			)
		).rejects.toThrow(/invalid ledger key/i);
	});
});

class FixtureListClient implements AnonymousS3ListObjectsClient {
	readonly requests: AnonymousS3ListObjectsRequest[] = [];

	constructor(private readonly results: AnonymousS3ListObjectsResult[]) {}

	destroy(): void {}

	list(
		request: AnonymousS3ListObjectsRequest
	): Promise<AnonymousS3ListObjectsResult> {
		this.requests.push(request);
		const result = this.results.shift();
		if (result === undefined) throw new Error('No fixture result');
		return Promise.resolve(result);
	}
}

function createFrontier(
	client: AnonymousS3ListObjectsClient
): AnonymousS3Sep54LedgerCloseMetaFrontier {
	return new AnonymousS3Sep54LedgerCloseMetaFrontier({
		bucket: 'aws-public-blockchain',
		client,
		ledgersPath: LEDGERS_PATH,
		region: 'us-east-2'
	});
}

const LEDGERS_PATH = 'v1.1/stellar/ledgers/pubnet';
const CONFIG: Sep54LedgerCloseMetaConfig = {
	batchesPerPartition: 64_000,
	compression: 'zstd',
	ledgersPerBatch: 1,
	networkPassphrase: 'Public Global Stellar Network ; September 2015',
	version: '1.0'
};
