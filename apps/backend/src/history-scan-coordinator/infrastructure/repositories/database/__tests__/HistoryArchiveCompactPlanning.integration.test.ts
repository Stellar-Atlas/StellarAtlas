import { DataSource } from 'typeorm';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	HistoryArchiveCheckpointProof
} from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { materializeCompactCheckpointPlans } from '../HistoryArchiveCompactPlanning.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucketMissingProof,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('compact history archive checkpoint planning', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('enqueues the next sequential checkpoint directly without a plan table', async () => {
		const root = createRoot(0);
		await dataSource.getRepository(HistoryArchiveObject).save(root);
		await dataSource.query(
			`insert into "history_archive_state_snapshot" (
				"archiveUrlIdentity", status, "currentLedger"
			) values ($1, 'available', 1000)`,
			[root.archiveUrlIdentity]
		);
		await dataSource.query(
			`insert into "history_archive_checkpoint_scan_cursor" (
				"archiveUrlIdentity", "latestCheckpointLedger",
				"lastForwardCheckpointLedger", "nextHistoricalCheckpointLedger"
			) values ($1, 959, 63, 127)`,
			[root.archiveUrlIdentity]
		);
		const predecessor = createBucketMissingProof(root.archiveUrlIdentity, 63);
		predecessor.status = 'verified';
		predecessor.proofVersion = CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION;
		predecessor.bucketsVerified = true;
		predecessor.verifiedBucketCount = predecessor.expectedBucketCount;
		predecessor.missingBucketCount = 0;
		predecessor.failureKind = null;
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(predecessor);

		const [planTableBefore] = (await dataSource.query(
			`select to_regclass('history_archive_object_plan') is null as absent`
		)) as readonly { readonly absent: boolean }[];
		const first = await materializeCompactCheckpointPlans(dataSource.manager);
		const second = await materializeCompactCheckpointPlans(dataSource.manager);
		const [checkpoint] = (await dataSource.query(
			`select status, "dependencyReady", "executionDisposition",
				"executionReason", "objectUrl"
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'checkpoint-state'
				and "checkpointLedger" = 127`,
			[root.archiveUrlIdentity]
		)) as readonly {
			readonly dependencyReady: boolean;
			readonly executionDisposition: string;
			readonly executionReason: string;
			readonly objectUrl: string;
			readonly status: string;
		}[];
		const [cursor] = (await dataSource.query(
			`select "nextHistoricalCheckpointLedger"
			 from "history_archive_checkpoint_scan_cursor"
			 where "archiveUrlIdentity" = $1`,
			[root.archiveUrlIdentity]
		)) as readonly { readonly nextHistoricalCheckpointLedger: number }[];

		expect(planTableBefore?.absent).toBe(true);
		expect([first, second]).toEqual([1, 0]);
		expect(checkpoint).toEqual({
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: 'planned-frontier',
			objectUrl: `${root.archiveUrl}/history/00/00/00/history-0000007f.json`,
			status: 'pending'
		});
		expect(cursor?.nextHistoricalCheckpointLedger).toBe(191);
	});
});
