import { DataSource } from 'typeorm';
import { fullHistoryUint64 } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryPromotionError } from '../../../../domain/full-history-promotion/FullHistoryPromotionError.js';
import {
	FULL_HISTORY_PROMOTION_EVIDENCE_EXIT_CODE,
	FULL_HISTORY_PROMOTION_SCHEMA_EXIT_CODE,
	FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE,
	FULL_HISTORY_PROMOTION_USAGE_EXIT_CODE,
	parseFullHistoryPromotionTarget,
	runFullHistoryPromotionCli,
	type FullHistoryPromotionCliDependencies
} from '../FullHistoryPromotionCli.js';
import { createFullHistoryPromotionDataSource } from '../FullHistoryPromotionComposition.js';

const validArgv = [
	'node',
	'promote',
	'--archive-url-identity',
	'https://archive.example/history/',
	'--checkpoint-ledger',
	'127',
	'--confirm-exact-checkpoint'
] as const;

const validEnvironment = {
	FULL_HISTORY_NETWORK_PASSPHRASE: 'Operator fixture network',
	FULL_HISTORY_PROMOTION_OPERATOR_CONFIRM: 'promote-one-checkpoint'
};

describe('full-history promotion CLI', () => {
	it('creates a distinct DataSource with automatic migrations disabled', () => {
		const dataSource = createFullHistoryPromotionDataSource();
		expect(dataSource.options.migrationsRun).toBe(false);
		expect(dataSource.options.poolSize).toBe(2);
		expect(dataSource.options.synchronize).toBe(false);
	});

	it('parses exactly one normalized archive and aligned checkpoint', () => {
		expect(
			parseFullHistoryPromotionTarget(validArgv, validEnvironment)
		).toEqual({
			archiveUrlIdentity: 'https://archive.example/history',
			checkpointLedger: 127,
			networkPassphrase: 'Operator fixture network'
		});
	});

	it.each([
		['broad range flags', ['node', 'promote', '--from', '63', '--to', '127']],
		[
			'range checkpoint value',
			[
				'node',
				'promote',
				'--archive-url-identity',
				'https://archive.example',
				'--checkpoint-ledger',
				'63-127',
				'--confirm-exact-checkpoint'
			]
		],
		['missing confirmation', validArgv.slice(0, -1)],
		['duplicate checkpoint', [...validArgv, '--checkpoint-ledger', '191']]
	] as const)('refuses %s', async (_label, argv) => {
		const fixture = createDependencies();
		await expect(
			runFullHistoryPromotionCli(argv, validEnvironment, fixture.dependencies)
		).resolves.toBe(FULL_HISTORY_PROMOTION_USAGE_EXIT_CODE);
		expect(fixture.initialize).not.toHaveBeenCalled();
		expect(fixture.promote).not.toHaveBeenCalled();
	});

	it('requires the operator environment confirmation and passphrase', async () => {
		const fixture = createDependencies();
		await expect(
			runFullHistoryPromotionCli(validArgv, {}, fixture.dependencies)
		).resolves.toBe(FULL_HISTORY_PROMOTION_USAGE_EXIT_CODE);
		expect(fixture.initialize).not.toHaveBeenCalled();
	});

	it('checks readiness, promotes one target, emits bounded JSON, and closes', async () => {
		const fixture = createDependencies();
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(0);
		expect(fixture.checkReadiness).toHaveBeenCalledTimes(1);
		expect(fixture.promote).toHaveBeenCalledWith(fixture.dataSource, {
			archiveUrlIdentity: 'https://archive.example/history',
			checkpointLedger: 127,
			networkPassphrase: 'Operator fixture network'
		});
		expect(fixture.destroy).toHaveBeenCalledTimes(1);
		expect(fixture.runMigrations).not.toHaveBeenCalled();
		const output = fixture.stdout.write.mock.calls[0]?.[0] as string;
		expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4_097);
		expect(JSON.parse(output)).toEqual({
			archiveUrlIdentity: 'https://archive.example/history',
			batchId: '00000000-0000-8000-8000-000000000001',
			checkpointLedger: 127,
			nextLedger: '128',
			status: 'promoted'
		});
		expect(output).not.toContain('Operator fixture network');
	});

	it('refuses pending migrations without invoking promotion', async () => {
		const fixture = createDependencies();
		fixture.checkReadiness.mockResolvedValue({
			missingSchemaObjects: [],
			pendingMigrations: true,
			ready: false
		});
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(FULL_HISTORY_PROMOTION_SCHEMA_EXIT_CODE);
		expect(fixture.promote).not.toHaveBeenCalled();
		expect(fixture.runMigrations).not.toHaveBeenCalled();
		expect(fixture.destroy).toHaveBeenCalledTimes(1);
	});

	it('refuses missing schema objects without invoking promotion', async () => {
		const fixture = createDependencies();
		fixture.checkReadiness.mockResolvedValue({
			missingSchemaObjects: ['relation:full_history_ledger'],
			pendingMigrations: false,
			ready: false
		});
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(FULL_HISTORY_PROMOTION_SCHEMA_EXIT_CODE);
		expect(fixture.promote).not.toHaveBeenCalled();
	});

	it('classifies proof rejection separately from infrastructure failure', async () => {
		const evidence = createDependencies();
		evidence.promote.mockRejectedValue(
			new FullHistoryPromotionError('invalid-proof', 'Proof is not strict')
		);
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				evidence.dependencies
			)
		).resolves.toBe(FULL_HISTORY_PROMOTION_EVIDENCE_EXIT_CODE);

		const unavailable = createDependencies();
		unavailable.initialize.mockRejectedValue(
			new Error(
				`postgresql://operator:secret@db.example unavailable ${'x'.repeat(2_000)}`
			)
		);
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				unavailable.dependencies
			)
		).resolves.toBe(FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE);
		const errorOutput = unavailable.stderr.write.mock.calls[0]?.[0] as string;
		expect(Buffer.byteLength(errorOutput)).toBeLessThanOrEqual(4_097);
		expect(errorOutput).not.toContain('operator:secret');
	});

	it('returns a structured temporary failure for creation or cleanup errors', async () => {
		const creation = createDependencies();
		const creationDependencies: FullHistoryPromotionCliDependencies = {
			...creation.dependencies,
			createDataSource: () => {
				throw new Error('DataSource creation failed');
			}
		};
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				creationDependencies
			)
		).resolves.toBe(FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE);

		const cleanup = createDependencies();
		cleanup.destroy.mockRejectedValueOnce(new Error('Connection close failed'));
		await expect(
			runFullHistoryPromotionCli(
				validArgv,
				validEnvironment,
				cleanup.dependencies
			)
		).resolves.toBe(FULL_HISTORY_PROMOTION_TEMPORARY_FAILURE_EXIT_CODE);
		expect(cleanup.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('cleanup-failed')
		);
	});
});

function createDependencies() {
	let initialized = false;
	const initialize = jest.fn(async () => {
		initialized = true;
		return dataSource;
	});
	const destroy = jest.fn(async () => {
		initialized = false;
	});
	const runMigrations = jest.fn();
	const dataSource = {
		destroy,
		initialize,
		get isInitialized() {
			return initialized;
		},
		options: { migrationsRun: false, synchronize: false },
		runMigrations
	} as unknown as DataSource;
	const checkReadiness = jest.fn().mockResolvedValue({
		missingSchemaObjects: [],
		pendingMigrations: false,
		ready: true
	});
	const promote = jest.fn().mockResolvedValue({
		batchId: '00000000-0000-8000-8000-000000000001',
		nextLedger: fullHistoryUint64('128'),
		replayed: false
	});
	const stderr = { write: jest.fn() };
	const stdout = { write: jest.fn() };
	const dependencies: FullHistoryPromotionCliDependencies = {
		checkReadiness,
		createDataSource: () => dataSource,
		promote,
		stderr,
		stdout
	};
	return {
		checkReadiness,
		dataSource,
		dependencies,
		destroy,
		initialize,
		promote,
		runMigrations,
		stderr,
		stdout
	};
}
