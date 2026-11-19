import { readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import { GoFullHistoryLedgerCloseMetaProcessor } from '../GoFullHistoryLedgerCloseMetaProcessor.js';
import type { DerivedOutputRecoveryReader } from '../FullHistoryDerivedOutputRetirement.js';
import { runGoFullHistoryStateExport } from '../../full-history-state-import/GoFullHistoryStateExportProcess.js';

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

	it.each([false, true])('publishes and replays exact output with compact ledger entries: %s', async (compact) => {
		const bytes = await readFile(
			join(
				process.cwd(),
				'apps/full-history-etl/internal/testdata/FCD285FF--53312000.xdr.zstd'
			)
		);
		const retirementRecoveryReader = jest.fn(async () => undefined);
		const processor = createProcessor(compact, retirementRecoveryReader);
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
			'account-state-changes',
			'contract-events',
			'ledger-close-meta',
			'ledger-entry-changes',
			'ledgers',
			'operations',
			'transaction-meta',
			'transaction-results',
			'transactions',
			'trustline-state-changes'
		]);
		expect(replay).toEqual(first);
		expect(retirementRecoveryReader).toHaveBeenCalledTimes(1);
		expect(retirementRecoveryReader).toHaveBeenCalledWith(
			Buffer.from('7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979', 'hex'),
			53_312_000,
			53_312_000
		);
		expect(first.outputs.find((output) => output.dataset === 'ledger-entry-changes')?.schemaVersion)
			.toBe(`stellar-atlas.full-history.ledger-entry-changes.v${compact ? '4' : '3'}`);
		await expect(createProcessor(!compact).processAndCommit(request, new AbortController().signal))
			.rejects.toThrow(/different ledger-entry-changes projection mode/);
		expect(first.sourceDisposition).toBe('discarded-after-processing');
		for (const dataset of [
			'account-state-changes',
			'trustline-state-changes'
		] as const) {
			const output = first.outputs.find(
				(candidate) => candidate.dataset === dataset
			);
			expect(output).toBeDefined();
			if (output === undefined)
				throw new Error(`Missing ${dataset} fixture output`);
			let consumed = 0n;
			await expect(
				runGoFullHistoryStateExport({
					args: [
						'--dataset',
						dataset,
						'--input',
						join(typedOutputRoot, output.storageKey)
					],
					consumeRow: () => {
						consumed += 1n;
						return Promise.resolve();
					},
					dataset,
					executablePath: join(
						dirname(executablePath!),
						'stellaratlas-full-history-state-export'
					),
					expectedSourceSha256: output.sha256,
					signal: new AbortController().signal,
					timeoutMilliseconds: 120_000
				})
			).resolves.toEqual({
				recordCount: BigInt(output.recordCount),
				sourceSha256: output.sha256
			});
			expect(consumed).toBe(BigInt(output.recordCount));
		}
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

	function createProcessor(compact = false, retirementRecoveryReader?: DerivedOutputRecoveryReader): GoFullHistoryLedgerCloseMetaProcessor {
		return new GoFullHistoryLedgerCloseMetaProcessor({
			executablePath: executablePath!,
			...(retirementRecoveryReader === undefined ? {} : { retirementRecoveryReader }),
			...(compact ? { compactLedgerEntryChanges: { startLedger: 53_312_000, endLedger: 53_312_000 } } : {}),
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
