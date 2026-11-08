import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { PinoLogger } from 'logger';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { HistoryArchiveBrokerFrontierRepository } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import { HistoryArchiveBrokerDispatcher } from './HistoryArchiveBrokerDispatcher.js';
import { getHistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';
import { createArchiveMaintenanceReporter } from './ArchiveMaintenanceReporter.js';

const options = AppDataSource.options;
if (options.type !== 'postgres')
	throw new Error('Archive broker dispatcher requires PostgreSQL');

const dataSource = new DataSource({
	...options,
	entities: [],
	migrations: [],
	migrationsRun: false,
	synchronize: false
});
await dataSource.initialize();

const logger = new PinoLogger(process.env.LOG_LEVEL ?? 'info');
const dispatcher = new HistoryArchiveBrokerDispatcher(
	new HistoryArchiveBrokerFrontierRepository(
		dataSource,
		createArchiveMaintenanceReporter(logger)
	),
	getHistoryArchiveBrokerConfig(),
	logger
);

let requestedClose: Promise<void> | null = null;
function close(): Promise<void> {
	if (requestedClose === null) {
		requestedClose = dispatcher.close();
		// Observe a deadline even while run() is still awaiting database or broker I/O.
		void requestedClose.catch((error: unknown) => {
			process.exitCode = 1;
			logger.error('Archive broker drain failed; handoff is not safe', {
				errorMessage: error instanceof Error ? error.message : String(error)
			});
		});
	}
	return requestedClose;
}
const onSignal = () => { void close(); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

try {
	await dispatcher.run();
} finally {
	try {
		// A timeout is not settlement. Wait for admitted work even after reporting failure.
		const [deadline, settlement] = await Promise.allSettled([
			close(), dispatcher.waitForShutdown()
		]);
		const [database] = await Promise.allSettled([
			Promise.resolve().then(async () => {
				if (dataSource.isInitialized) await dataSource.destroy();
			})
		]);
		const failures = [...new Set([deadline, settlement, database].flatMap(result =>
			result.status === 'rejected' ? [result.reason] : []
		))];
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Archive broker shutdown failed');
	} finally {
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
	}
}
