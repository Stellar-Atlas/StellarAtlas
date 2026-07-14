import { readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import { GoFullHistoryLedgerCloseMetaProcessor } from '../GoFullHistoryLedgerCloseMetaProcessor.js';

const executablePath = process.env.FULL_HISTORY_ETL_TEST_BINARY;
const describeWithBinary =
	executablePath === undefined ? describe.skip : describe;

describeWithBinary('GoFullHistoryLedgerCloseMetaProcessor', () => {
	const root = join(tmpdir(), `stellaratlas-full-history-etl-${process.pid}`);
	const temporaryInputRoot = join(
		'/dev/shm',
		`stellaratlas-full-history-etl-test-${process.pid}`
	);
	const typedOutputRoot = join(root, 'typed');

	afterEach(async () => {
		await Promise.all([
			rm(root, { force: true, recursive: true }),
			rm(temporaryInputRoot, { force: true, recursive: true })
		]);
	});

	it('publishes typed datasets, discards input, and replays exact output', async () => {
		const bytes = await readFile(
			join(
				process.cwd(),
				'apps/full-history-etl/internal/testdata/FCD285FF--53312000.xdr.zstd'
			)
		);
		const processor = createProcessor();
		const request = requestFor(bytes);

		const first = await processor.processAndCommit(
			request,
			new AbortController().signal
		);
		const replay = await processor.processAndCommit(
			request,
			new AbortController().signal
		);

		expect(first.outputs.map((output) => output.dataset).sort()).toEqual([
			'contract-events',
			'ledger-close-meta',
			'ledger-entry-changes',
			'ledgers',
			'operations',
			'transaction-meta',
			'transaction-results',
			'transactions'
		]);
		expect(replay).toEqual(first);
		expect(first.sourceDisposition).toBe('discarded-after-processing');
		expect(await readdir(temporaryInputRoot)).toEqual([]);
	});

	it('discards malformed transient input after processor failure', async () => {
		const processor = createProcessor();
		await expect(
			processor.processAndCommit(
				requestFor(Buffer.from('not a LedgerCloseMeta batch')),
				new AbortController().signal
			)
		).rejects.toThrow();
		expect(await readdir(temporaryInputRoot)).toEqual([]);
	});

	function createProcessor(): GoFullHistoryLedgerCloseMetaProcessor {
		return new GoFullHistoryLedgerCloseMetaProcessor({
			executablePath: executablePath!,
			limits: {
				maximumCompressedBytes: 256 << 20,
				maximumDecodedMemoryBytes: 512 << 20,
				maximumLedgers: 1,
				maximumOutputBytes: 1 << 30,
				maximumRows: 1_000_000,
				maximumUncompressedBytes: 512 << 20
			},
			maximumConcurrency: 2,
			maximumQueueDepth: 2,
			minimumLedgers: 1,
			networkName: 'pubnet',
			processTimeoutMilliseconds: 120_000,
			temporaryInputRoot,
			typedOutputRoot
		});
	}

	function requestFor(bytes: Buffer) {
		return {
			inputs: [
				{
					expectedRange: fullHistoryLedgerCloseMetaRange(
						53_312_000,
						53_312_000
					),
					object: {
						bytes,
						identity: {
							generation: `sha256:${sha256(bytes)}`,
							objectKey: 'fixture.xdr.zstd',
							sourceUri: 'https://fixture.invalid/fixture.xdr.zstd'
						}
					}
				}
			],
			networkPassphrase: NETWORK_PASSPHRASE,
			source: {
				configDigest: fullHistoryLedgerCloseMetaSha256Digest('11'.repeat(32)),
				sourceId: 'fixture-source'
			}
		};
	}
});

const NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
