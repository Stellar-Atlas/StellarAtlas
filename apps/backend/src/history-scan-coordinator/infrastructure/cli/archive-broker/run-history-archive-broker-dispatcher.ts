import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { PinoLogger } from 'logger';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { HistoryArchiveBrokerFrontierRepository } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import { HistoryArchiveBrokerDispatcher } from './HistoryArchiveBrokerDispatcher.js';
import { getHistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';

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
	new HistoryArchiveBrokerFrontierRepository(dataSource),
	getHistoryArchiveBrokerConfig(),
	logger
);

let closing = false;
const close = async (): Promise<void> => {
	if (closing) return;
	closing = true;
	await dispatcher.close();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

try {
	await dispatcher.run();
} finally {
	await close();
	if (dataSource.isInitialized) await dataSource.destroy();
}
