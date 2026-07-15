import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	composeFullHistoryStateImportWorkers,
	createFullHistoryStateImportDataSource
} from '../FullHistoryStateImportComposition.js';
import { parseFullHistoryStateImportServiceConfig } from '../FullHistoryStateImportServiceConfig.js';

describe('FullHistoryStateImportComposition', () => {
	it('creates a non-migrating database pool bounded for four workers', () => {
		const dataSource = createFullHistoryStateImportDataSource(6);
		expect(dataSource.options).toEqual(
			expect.objectContaining({
				migrationsRun: false,
				poolSize: 6,
				synchronize: false,
				type: 'postgres'
			})
		);
		expect(() => createFullHistoryStateImportDataSource(7)).toThrow(
			/outside its bounds/
		);
	});

	it('composes four distinct lease owners in one process', () => {
		const ids = Array.from({ length: 4 }, () => randomUUID());
		const workers = composeFullHistoryStateImportWorkers(
			new DataSource({ type: 'postgres' }),
			parseFullHistoryStateImportServiceConfig({
				FULL_HISTORY_STATE_IMPORT_ENABLED: 'true'
			}),
			() => ids.shift()!
		);
		expect(workers.map((worker) => worker.workerIndex)).toEqual([1, 2, 3, 4]);
		expect(new Set(workers.map((worker) => worker.workerId)).size).toBe(4);
	});

	it('fails closed if lease-owner generation collides', () => {
		const id = randomUUID();
		expect(() =>
			composeFullHistoryStateImportWorkers(
				new DataSource({ type: 'postgres' }),
				parseFullHistoryStateImportServiceConfig({
					FULL_HISTORY_STATE_IMPORT_ENABLED: 'true'
				}),
				() => id
			)
		).toThrow(/distinct lease owners/);
	});
});
