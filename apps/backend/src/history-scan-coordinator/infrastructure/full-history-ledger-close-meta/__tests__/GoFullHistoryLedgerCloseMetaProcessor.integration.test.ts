import { readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import { GoFullHistoryLedgerCloseMetaProcessor } from '../GoFullHistoryLedgerCloseMetaProcessor.js';
import type { DerivedOutputRecovery, DerivedOutputRecoveryReader } from '../FullHistoryDerivedOutputRetirement.js';
import { parseGoFullHistoryLedgerCloseMetaReceipt } from '../GoFullHistoryLedgerCloseMetaReceipt.js';
import { verifyGoFullHistoryLedgerCloseMetaPublication } from '../GoFullHistoryLedgerCloseMetaPublicationVerifier.js';
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

	it('separates namespace recovery from physical accounting and validates present or mandatory files', async () => {
		const bytes = await readFile(join(process.cwd(),
			'apps/full-history-etl/internal/testdata/FCD285FF--53312000.xdr.zstd'));
		const request = requestFor(bytes);
		const first = await createProcessor().processAndCommit(request, new AbortController().signal);
		const transaction = first.outputs.find(output => output.dataset === 'transactions');
		const canonical = first.outputs.find(output => output.dataset === 'ledger-close-meta');
		const ledgers = first.outputs.find(output => output.dataset === 'ledgers');
		if (!transaction || !canonical || !ledgers) throw new Error('missing existing fixture outputs');
		const outputPath = dirname(join(typedOutputRoot, transaction.storageKey));
		const manifestStorageKey = posix.join(posix.dirname(transaction.storageKey), 'manifest.json');
		const manifest = JSON.parse(await readFile(join(typedOutputRoot, manifestStorageKey), 'utf8')) as Record<string, unknown>;
		const receipt = parseGoFullHistoryLedgerCloseMetaReceipt({
			inputMediaType: manifest.inputMediaType, manifestSha256: first.manifestSha256,
			manifestStorageKey, network: manifest.network, outputs: manifest.outputs,
			range: manifest.range, sourceObjects: manifest.sourceObjects
		});
		const retired = {
			dataset: 'transactions' as const, outputSha256: transaction.sha256,
			byteCount: String(transaction.byteCount), recordCount: String(transaction.recordCount),
			storageKey: transaction.storageKey, removed: false, evidenceSha256: '11'.repeat(32),
			transformRevision: '22'.repeat(20)
		};
		const identity = {
			batchId: '00000000-0000-4000-8000-000000000001',
			networkIdSha256: receipt.network.networkIdSha256,
			startLedger: receipt.range.startSequence, endLedger: receipt.range.endSequence,
			manifestSha256: receipt.manifestSha256, canonicalSha256: canonical.sha256
		};
		const namespace: DerivedOutputRecovery = { ...identity, version: 2,
			outputs: [{ ...retired, namespaceRemoved: true, namespaceIntentSha256: '33'.repeat(32) }] };
		const legacy: DerivedOutputRecovery = { ...identity, version: 1, outputs: [retired] };
		const physical: DerivedOutputRecovery = { ...identity, version: 2,
			outputs: [{ ...retired, removed: true, namespaceRemoved: false, namespaceIntentSha256: null }] };
		const verify = (retirementRecovery?: DerivedOutputRecovery) => verifyGoFullHistoryLedgerCloseMetaPublication({
			networkName: 'pubnet', outputPath, receipt, request, typedOutputRoot,
			...(retirementRecovery === undefined ? {} : { retirementRecovery })
		});
		const transactionPath = join(typedOutputRoot, transaction.storageKey);
		const original = await readFile(transactionPath);
		await expect(verify(namespace)).resolves.toEqual(first);
		await unlink(transactionPath);
		await expect(verify(namespace)).resolves.toEqual(first);
		await expect(createProcessor(false, async () => namespace).processAndCommit(request,
			new AbortController().signal)).resolves.toEqual(first);
		await expect(verify()).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(verify(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(verify({ ...identity, version: 2,
			outputs: [{ ...retired, namespaceRemoved: false, namespaceIntentSha256: null }] }))
			.rejects.toMatchObject({ code: 'ENOENT' });
		await expect(verify(physical)).resolves.toEqual(first);
		await expect(verify({ ...identity, version: 1, outputs: [{ ...retired, removed: true }] })).resolves.toEqual(first);
		await writeFile(transactionPath, original, { flag: 'wx' });
		await expect(verify(namespace)).resolves.toEqual(first);
		await expect(verify(physical)).rejects.toThrow('published unexpected files');
		await expect(verify({ ...identity, version: 1, outputs: [{ ...retired, removed: true }] }))
			.rejects.toThrow('published unexpected files');
		await expect(verify({ ...identity, version: 2,
			outputs: [{ ...retired, removed: true, namespaceRemoved: true, namespaceIntentSha256: '33'.repeat(32) }] }))
			.rejects.toThrow('published unexpected files');
		const corrupt = Buffer.from(original);
		corrupt[0] = corrupt[0]! ^ 1;
		await writeFile(transactionPath, corrupt);
		await expect(verify(namespace)).rejects.toThrow('transactions hash mismatch');
		await writeFile(transactionPath, Buffer.concat([original, Buffer.from([0])]));
		await expect(verify(namespace)).rejects.toThrow('output size mismatch');
		await unlink(transactionPath);
		await symlink(join(typedOutputRoot, canonical.storageKey), transactionPath);
		await expect(verify(namespace)).rejects.toThrow();
		await unlink(transactionPath);
		await writeFile(transactionPath, original, { flag: 'wx' });
		const canonicalPath = join(typedOutputRoot, canonical.storageKey);
		const canonicalBytes = await readFile(canonicalPath);
		await unlink(canonicalPath);
		await expect(verify(namespace)).rejects.toMatchObject({ code: 'ENOENT' });
		await writeFile(canonicalPath, canonicalBytes, { flag: 'wx' });
		await unlink(join(typedOutputRoot, ledgers.storageKey));
		await expect(verify(namespace)).rejects.toMatchObject({ code: 'ENOENT' });
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
