import 'reflect-metadata';
import Kernel from '@core/infrastructure/Kernel.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import { DataSource } from 'typeorm';
import { CrossCheckRadarNetworkComparisonSnapshot } from '../database/entities/CrossCheckRadarNetworkComparisonSnapshot.js';
import { TypeOrmCrossCheckRadarNetworkRefreshLock } from '../database/TypeOrmCrossCheckRadarNetworkRefreshLock.js';
import { TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository } from '../database/repositories/TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository.js';
import { RadarNetworkSnapshotSourceAdapter } from '../radar/RadarNetworkSnapshotSourceAdapter.js';
import { StellarAtlasNetworkRowsSourceAdapter } from '../stellar-atlas/StellarAtlasNetworkRowsSourceAdapter.js';
import { CompareRadarNetworkSnapshot } from '../../use-cases/compare-radar-network-snapshot/CompareRadarNetworkSnapshot.js';
import { RefreshRadarNetworkComparisonSnapshotLoop } from '../../use-cases/refresh-radar-network-comparison-snapshot-loop/RefreshRadarNetworkComparisonSnapshotLoop.js';
import {
	RefreshRadarNetworkComparisonSnapshotRunner,
	type RefreshRadarNetworkComparisonSnapshotRunnerOutcome
} from '../../use-cases/refresh-radar-network-comparison-snapshot-runner/RefreshRadarNetworkComparisonSnapshotRunner.js';
import { RefreshRadarNetworkComparisonSnapshot } from '../../use-cases/refresh-radar-network-comparison-snapshot/RefreshRadarNetworkComparisonSnapshot.js';
import { parseRadarNetworkComparisonRefreshCliOptions } from './RadarNetworkComparisonRefreshCliOptions.js';

// noinspection JSIgnoredPromiseFromCall
run();

async function run(): Promise<void> {
	let kernel: Kernel | null = null;
	let loop: RefreshRadarNetworkComparisonSnapshotLoop | null = null;

	try {
		const options = parseRadarNetworkComparisonRefreshCliOptions(
			process.argv.slice(2)
		);
		kernel = await Kernel.getInstance();
		loop = new RefreshRadarNetworkComparisonSnapshotLoop(
			createRefreshRunner(kernel)
		);
		process
			.on('SIGTERM', () => loop?.shutDown())
			.on('SIGINT', () => loop?.shutDown());

		const result = await loop.execute(
			{
				freshnessMs: options.freshnessMs,
				intervalMs: options.intervalMs,
				loop: options.loop,
				radar: {
					maxBytes: options.radarMaxBytes,
					timeoutMs: options.radarTimeoutMs
				}
			},
			(outcome) => console.log(formatOutcome(outcome))
		);

		if (result.isErr()) throw result.error;
	} catch (error) {
		const mappedError = mapUnknownToError(error);
		console.error(mappedError.message);
		process.exitCode = 1;
	} finally {
		if (kernel !== null) await kernel.shutdown();
	}
}

function createRefreshRunner(
	kernel: Kernel
): RefreshRadarNetworkComparisonSnapshotRunner {
	const dataSource = kernel.container.get(DataSource);
	const repository =
		new TypeOrmCrossCheckRadarNetworkComparisonSnapshotRepository(
			dataSource.getRepository(CrossCheckRadarNetworkComparisonSnapshot)
		);

	return new RefreshRadarNetworkComparisonSnapshotRunner(
		new TypeOrmCrossCheckRadarNetworkRefreshLock(dataSource),
		repository,
		new RefreshRadarNetworkComparisonSnapshot(
			new RadarNetworkSnapshotSourceAdapter(),
			new StellarAtlasNetworkRowsSourceAdapter(
				kernel.container.get(GetNetwork)
			),
			repository,
			new CompareRadarNetworkSnapshot()
		)
	);
}

function formatOutcome(
	outcome: RefreshRadarNetworkComparisonSnapshotRunnerOutcome
): string {
	if (outcome.status === 'skipped_locked') {
		return 'radar-network-comparison skipped_locked';
	}

	return `radar-network-comparison ${outcome.status} ${outcome.latest.id} ${outcome.latest.status} ${outcome.latest.generatedAt}`;
}
