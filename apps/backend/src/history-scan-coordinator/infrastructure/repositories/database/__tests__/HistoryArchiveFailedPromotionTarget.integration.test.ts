import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { canonicalRuntimeTargetCtes } from '../HistoryArchiveCanonicalFrontierSql.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';

const networkPassphrase = 'Failed promotion recovery fixture';
const targetCheckpoint = 1_000_063;
jest.setTimeout(60_000);

describe('failed promotion canonical target recovery', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			logging: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate "full_history_historical_backfill_job", "full_history_watermark", "full_history_promotion_runtime"'
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('selects proof-blocked invalid source evidence for repair', async () => {
		await seedFailedRuntime('promotion-invalid-source-evidence');

		const targets = await readRuntimeTargets();

		expect(targets).toEqual([
			{ checkpointLedger: targetCheckpoint, targetLane: 'forward' }
		]);
	});

	it('does not reopen unrelated failed promotion work', async () => {
		await seedFailedRuntime('promotion-storage-failure');

		expect(await readRuntimeTargets()).toEqual([]);
	});

	async function seedFailedRuntime(errorCode: string): Promise<void> {
		await dataSource.query(
			`insert into "full_history_promotion_runtime" (
				"network_passphrase_hash", state, "checkpoint_ledger",
				"last_outcome", "last_error_code"
			) values ($1, 'failed', $2, 'proof-pending', $3)`,
			[
				createHash('sha256').update(networkPassphrase, 'utf8').digest(),
				targetCheckpoint,
				errorCode
			]
		);
	}

	async function readRuntimeTargets(): Promise<readonly RuntimeTarget[]> {
		return (await dataSource.query(`
			with ${canonicalRuntimeTargetCtes}
			select checkpoint_ledger as "checkpointLedger",
				target_lane as "targetLane"
			from runtime_target
		`)) as readonly RuntimeTarget[];
	}
});

interface RuntimeTarget {
	readonly checkpointLedger: number;
	readonly targetLane: string;
}
