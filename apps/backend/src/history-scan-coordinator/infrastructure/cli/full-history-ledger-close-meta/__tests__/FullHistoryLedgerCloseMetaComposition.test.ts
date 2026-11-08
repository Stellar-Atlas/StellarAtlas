import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFullHistoryLedgerCloseMetaServiceConfig } from '../FullHistoryLedgerCloseMetaServiceConfig.js';
import { managedMigrations } from '@core/infrastructure/database/ManagedMigrations.js';
import {
	assertFullHistoryLedgerCloseMetaMemoryEnvelope,
	composeFullHistoryLedgerCloseMetaService,
	createFullHistoryLedgerCloseMetaDataSource,
	FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES
} from '../FullHistoryLedgerCloseMetaComposition.js';

describe('FullHistoryLedgerCloseMetaComposition', () => {
	it('retains every migration except the three independent feature migrations', () => {
		const dataSource = createFullHistoryLedgerCloseMetaDataSource({
			admissionEnabled: false,
			admissionMaximumDatabaseProbeMilliseconds: 1_000
		});
		const unrelatedNames = new Set([
			'HistoryArchiveHeaderProofRepairQueueKindMigration1793384400000',
			'AtlasAccountVerification1794091000000',
			'AtlasVerificationAuthentication1794092000000'
		]);
		expect(dataSource.options.migrations).toEqual(
			managedMigrations.filter((migration) => !unrelatedNames.has(migration.name))
		);
		expect(dataSource.options.migrations).toHaveLength(managedMigrations.length - 3);
		expect(dataSource.options.migrationsRun).toBe(false);
		expect(dataSource.options.synchronize).toBe(false);
	});

	it.each([
		'ops/systemd/stellaratlas-full-history-ledger-close-meta.service',
		'ops/systemd/host/stellaratlas-full-history-ledger-close-meta.service'
	])('constructs the complete runtime from %s', (path) => {
		const unit = readFileSync(join(process.cwd(), path), 'utf8');
		const environment: NodeJS.ProcessEnv = {};
		for (const line of unit.split('\n')) {
			if (!line.startsWith('Environment=')) continue;
			const assignment = line
				.slice('Environment='.length)
				.replace(/^"|"$/g, '');
			const separator = assignment.indexOf('=');
			environment[assignment.slice(0, separator)] = assignment.slice(
				separator + 1
			);
		}
		const config = parseFullHistoryLedgerCloseMetaServiceConfig(environment);
		expect(() =>
			composeFullHistoryLedgerCloseMetaService(config)
		).not.toThrow();
		const memoryGiB = Number(unit.match(/^MemoryMax=(\d+)G$/m)?.[1]);
		expect(memoryGiB * 1_024 ** 3).toBe(
			FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES
		);
	});

	it('keeps twelve processors below the 128 GiB service memory limit', () => {
		expect(FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES).toBe(
			128 * 1_024 ** 3
		);
		expect(() =>
			assertFullHistoryLedgerCloseMetaMemoryEnvelope(12)
		).not.toThrow();
	});

	it('rejects a processor count outside the aggregate memory envelope', () => {
		expect(() => assertFullHistoryLedgerCloseMetaMemoryEnvelope(13)).toThrow(
			/memory envelope/i
		);
	});
});
