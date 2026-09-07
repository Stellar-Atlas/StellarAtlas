import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { seedHistoryArchiveCheckpointScanChunk } from '../../repositories/database/HistoryArchiveCheckpointScanSeed.js';
import { parseCheckpointScanSeedCliOptions } from './CheckpointScanSeedCliOptions.js';
import { runCheckpointScanSeedLoop } from './CheckpointScanSeedLoop.js';

async function run(): Promise<void> {
	const options = parseCheckpointScanSeedCliOptions(process.argv.slice(2));
	const database = new DataSource({
		...AppDataSource.options,
		entities: [],
		migrations: [],
		migrationsRun: false,
		synchronize: false,
		logging: false,
		extra: {
			...AppDataSource.options.extra,
			max: 1,
			connectionTimeoutMillis: 5_000,
			statement_timeout: 1_500,
			application_name: 'archive-checkpoint-scan-seed'
		}
	});
	try {
		await database.initialize();
		await runCheckpointScanSeedLoop(
			options,
			() =>
				seedHistoryArchiveCheckpointScanChunk(database, {
					rowLimit: options.rowLimit
				}),
			(progress) => process.stdout.write(JSON.stringify(progress) + '\n')
		);
	} finally {
		if (database.isInitialized) await database.destroy();
	}
}

run().catch((error: unknown) => {
	// Do not print connection URLs, SQL parameters, or opaque database errors.
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String(error.code)
			: 'INVALID_OPTIONS_OR_SEED_STATE';
	process.stderr.write(
		JSON.stringify({ error: 'scan-coverage-seed-stopped', code }) + '\n'
	);
	process.exitCode = 1;
});
