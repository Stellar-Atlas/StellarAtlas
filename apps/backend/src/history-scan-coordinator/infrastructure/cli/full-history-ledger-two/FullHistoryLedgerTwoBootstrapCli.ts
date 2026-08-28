import type { DataSource } from 'typeorm';
import { canonicalLedgerTwoBootstrap } from '../../full-history-ledger-close-meta/CanonicalLedgerTwo.js';
import { GoFullHistoryLedgerCloseMetaProcessor } from '../../full-history-ledger-close-meta/GoFullHistoryLedgerCloseMetaProcessor.js';
import { TypeOrmFullHistoryLedgerCloseMetaManifestRepository } from '../../database/full-history-ledger-close-meta/TypeOrmFullHistoryLedgerCloseMetaManifestRepository.js';
import { createFullHistoryLedgerCloseMetaDataSource } from '../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaComposition.js';
import {
	parseFullHistoryLedgerCloseMetaServiceConfig,
	type FullHistoryLedgerCloseMetaServiceConfig
} from '../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaServiceConfig.js';

const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

export interface FullHistoryLedgerTwoBootstrapDependencies {
	readonly createDataSource: (
		config: FullHistoryLedgerCloseMetaServiceConfig
	) => DataSource;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
}

const defaultDependencies: FullHistoryLedgerTwoBootstrapDependencies = {
	createDataSource: createFullHistoryLedgerCloseMetaDataSource,
	stderr: process.stderr,
	stdout: process.stdout
};

export async function runFullHistoryLedgerTwoBootstrapCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: FullHistoryLedgerTwoBootstrapDependencies = defaultDependencies
): Promise<number> {
	let dataSource: DataSource | null = null;
	try {
		const config = parseFullHistoryLedgerCloseMetaServiceConfig(environment);
		const bootstrap = canonicalLedgerTwoBootstrap(config.networkPassphrase);
		dataSource = dependencies.createDataSource(config);
		await dataSource.initialize();
		const repository = new TypeOrmFullHistoryLedgerCloseMetaManifestRepository(
			dataSource
		);
		const source = await repository.registerSource(bootstrap.registration);
		const processor = new GoFullHistoryLedgerCloseMetaProcessor({
			executablePath: config.executablePath,
			limits: {
				maximumCompressedBytes: 1_024,
				maximumDecodedMemoryBytes: 64 * 1_024 * 1_024,
				maximumLedgers: 1,
				maximumOutputBytes: 64 * 1_024 * 1_024,
				maximumRows: 1_000_000,
				maximumUncompressedBytes: 4_096
			},
			maximumConcurrency: 1,
			maximumQueueDepth: 1,
			minimumLedgers: 1,
			networkName: config.networkName,
			processTimeoutMilliseconds: config.processTimeoutMilliseconds,
			temporaryInputRoot: config.temporaryInputRoot,
			typedOutputRoot: config.typedOutputRoot
		});
		const processing = await processor.processAndCommit(
			{
				inputs: [
					{
						expectedRange: {
							endSequence: bootstrap.registration.firstAvailableLedger,
							ledgerCount: 1,
							startSequence: bootstrap.registration.firstAvailableLedger
						},
						object: bootstrap.object
					}
				],
				networkPassphrase: config.networkPassphrase,
				source: {
					configDigest: source.configDigest,
					sourceId: source.sourceId
				}
			},
			AbortSignal.timeout(config.processTimeoutMilliseconds + 10_000)
		);
		const receipt = await repository.commitLedgerTwoBootstrap({
			processedAt: new Date(),
			processing,
			source
		});
		writeJson(dependencies.stdout, {
			batchId: receipt.batchId,
			firstLedger: 2,
			nextLedger: receipt.nextLedger,
			status: receipt.replayed ? 'replayed' : 'bootstrapped',
			watermarkVersion: receipt.watermarkVersion
		});
		return 0;
	} catch (error) {
		writeJson(dependencies.stderr, {
			message: safeErrorMessage(error),
			status: 'failed'
		});
		return 1;
	} finally {
		if (dataSource?.isInitialized) {
			try {
				await dataSource.destroy();
			} catch (error) {
				writeJson(dependencies.stderr, {
					message: safeErrorMessage(error),
					status: 'cleanup-failed'
				});
			}
		}
	}
}

function writeJson(output: WritableOutput, value: object): void {
	const serialized = JSON.stringify(value);
	output.write(
		(serialized.length <= maximumOutputBytes
			? serialized
			: JSON.stringify({ status: 'output-bound-exceeded' })) + '\n'
	);
}

function safeErrorMessage(error: unknown): string {
	return (error instanceof Error ? error.message : String(error))
		.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.slice(0, 384);
}
