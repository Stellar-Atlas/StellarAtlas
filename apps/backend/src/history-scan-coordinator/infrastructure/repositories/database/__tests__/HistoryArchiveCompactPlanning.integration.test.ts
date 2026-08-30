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
import {
	materializeCompactCheckpointPlans,
	materializeNextCompactCheckpointPlan
} from '../HistoryArchiveCompactPlanning.js';
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

	it('enqueues the completed root next checkpoint inside the proof transaction', async () => {
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
		const first = await materializeNextCompactCheckpointPlan(
			dataSource.manager,
			root.archiveUrlIdentity,
			63
		);
		const second = await materializeNextCompactCheckpointPlan(
			dataSource.manager,
			root.archiveUrlIdentity,
			63
		);
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
		const [prefetched] = (await dataSource.query(
			`select count(*)::integer as count
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'checkpoint-state'
				and "checkpointLedger" in (127, 959)`,
			[root.archiveUrlIdentity]
		)) as readonly { readonly count: number }[];
		const [ready] = (await dataSource.query(
			`select ready.priority
			 from "history_archive_object_ready" ready
			 join "history_archive_object_queue" object
				on object."remoteId" = ready."objectRemoteId"
			 where object."archiveUrlIdentity" = $1
				and object."objectType" = 'checkpoint-state'
				and object."checkpointLedger" = 127`,
			[root.archiveUrlIdentity]
		)) as readonly { readonly priority: number }[];
		const [cursor] = (await dataSource.query(
			`select "nextHistoricalCheckpointLedger"
			 from "history_archive_checkpoint_scan_cursor"
			 where "archiveUrlIdentity" = $1`,
			[root.archiveUrlIdentity]
		)) as readonly { readonly nextHistoricalCheckpointLedger: number }[];

		expect(planTableBefore?.absent).toBe(true);
		expect([first, second]).toEqual([2, 0]);
		expect(prefetched?.count).toBe(2);
		expect(checkpoint).toEqual({
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: 'planned-frontier',
			objectUrl: `${root.archiveUrl}/history/00/00/00/history-0000007f.json`,
			status: 'pending'
		});
		expect(ready).toEqual({ priority: 2 });
		expect(cursor?.nextHistoricalCheckpointLedger).toBe(191);
	});

	it('skips a contiguous prefix of already-verified checkpoints at once', async () => {
		const root = createRoot(1);
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
		const proofs = [63, 127, 191].map((checkpointLedger) => {
			const proof = createBucketMissingProof(
				root.archiveUrlIdentity,
				checkpointLedger
			);
			proof.status = 'verified';
			proof.proofVersion = CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION;
			proof.bucketsVerified = true;
			proof.verifiedBucketCount = proof.expectedBucketCount;
			proof.missingBucketCount = 0;
			proof.failureKind = null;
			return proof;
		});
		await dataSource.getRepository(HistoryArchiveCheckpointProof).save(proofs);

		const planned = await materializeCompactCheckpointPlans(
			dataSource.manager,
			[root.archiveUrlIdentity]
		);
		const [checkpoint] = (await dataSource.query(
			`select status, "dependencyReady", "executionDisposition"
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'checkpoint-state'
				and "checkpointLedger" = 255`,
			[root.archiveUrlIdentity]
		)) as readonly {
			readonly dependencyReady: boolean;
			readonly executionDisposition: string;
			readonly status: string;
		}[];
		const [cursor] = (await dataSource.query(
			`select "nextHistoricalCheckpointLedger"
			 from "history_archive_checkpoint_scan_cursor"
			 where "archiveUrlIdentity" = $1`,
			[root.archiveUrlIdentity]
		)) as readonly { readonly nextHistoricalCheckpointLedger: number }[];

		expect(planned).toBe(1);
		expect(checkpoint).toEqual({
			dependencyReady: true,
			executionDisposition: 'executable',
			status: 'pending'
		});
		expect(cursor?.nextHistoricalCheckpointLedger).toBe(319);
	});
});
