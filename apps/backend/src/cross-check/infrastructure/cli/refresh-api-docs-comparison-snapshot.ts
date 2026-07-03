import 'reflect-metadata';
import openApiDocument from '../../../../openapi.json' with { type: 'json' };
import Kernel from '@core/infrastructure/Kernel.js';
import { DataSource } from 'typeorm';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { TypeOrmCrossCheckApiDocsRefreshLock } from '../database/TypeOrmCrossCheckApiDocsRefreshLock.js';
import { CrossCheckApiDocsComparisonSnapshot } from '../database/entities/CrossCheckApiDocsComparisonSnapshot.js';
import { TypeOrmCrossCheckApiDocsComparisonSnapshotRepository } from '../database/repositories/TypeOrmCrossCheckApiDocsComparisonSnapshotRepository.js';
import { RadarApiDocsSourceAdapter } from '../radar/RadarApiDocsSourceAdapter.js';
import { StellarAtlasApiDocsSourceAdapter } from '../stellar-atlas/StellarAtlasApiDocsSourceAdapter.js';
import { CompareRadarApiDocsOperations } from '../../use-cases/compare-radar-api-docs/CompareRadarApiDocsOperations.js';
import { RefreshApiDocsComparisonSnapshot } from '../../use-cases/refresh-api-docs-comparison-snapshot/RefreshApiDocsComparisonSnapshot.js';
import { RefreshApiDocsComparisonSnapshotLoop } from '../../use-cases/refresh-api-docs-comparison-snapshot-loop/RefreshApiDocsComparisonSnapshotLoop.js';
import {
	RefreshApiDocsComparisonSnapshotRunner,
	type RefreshApiDocsComparisonSnapshotRunnerOutcome
} from '../../use-cases/refresh-api-docs-comparison-snapshot-runner/RefreshApiDocsComparisonSnapshotRunner.js';
import { parseApiDocsComparisonRefreshCliOptions } from './ApiDocsComparisonRefreshCliOptions.js';

// noinspection JSIgnoredPromiseFromCall
run();

async function run(): Promise<void> {
	let kernel: Kernel | null = null;
	let loop: RefreshApiDocsComparisonSnapshotLoop | null = null;

	try {
		const options = parseApiDocsComparisonRefreshCliOptions(
			process.argv.slice(2)
		);
		kernel = await Kernel.getInstance();
		loop = new RefreshApiDocsComparisonSnapshotLoop(
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
				},
				stellarAtlas: {
					documentationUrl: options.stellarAtlasDocumentationUrl
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
): RefreshApiDocsComparisonSnapshotRunner {
	const dataSource = kernel.container.get(DataSource);
	const repository = new TypeOrmCrossCheckApiDocsComparisonSnapshotRepository(
		dataSource.getRepository(CrossCheckApiDocsComparisonSnapshot)
	);

	return new RefreshApiDocsComparisonSnapshotRunner(
		new TypeOrmCrossCheckApiDocsRefreshLock(dataSource),
		repository,
		new RefreshApiDocsComparisonSnapshot(
			new RadarApiDocsSourceAdapter(),
			new StellarAtlasApiDocsSourceAdapter(openApiDocument),
			repository,
			new CompareRadarApiDocsOperations()
		)
	);
}

function formatOutcome(
	outcome: RefreshApiDocsComparisonSnapshotRunnerOutcome
): string {
	if (outcome.status === 'skipped_locked') {
		return 'api-docs-comparison skipped_locked';
	}

	return `api-docs-comparison ${outcome.status} ${outcome.latest.id} ${outcome.latest.status} ${outcome.latest.generatedAt}`;
}
