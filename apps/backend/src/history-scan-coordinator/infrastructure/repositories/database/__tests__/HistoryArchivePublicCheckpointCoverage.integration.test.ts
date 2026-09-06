import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { getCheckpointCoverage } from '../HistoryArchiveObjectCheckpointCoverageQuery.js';
import { sourceCountSql } from '../HistoryArchiveObjectStatusSummaryQuery.js';

const legacyIdentity = 'http://history.example/galou';
const publicRoots = [
	'http://history.example/GALOU',
	'https://history.example/CaseRoot',
	'https://history.example/caseroot',
	'https://listener.example/archive',
	'https://history.example/GALOU'
];

jest.setTimeout(60_000);

describe('public checkpoint coverage scope', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createSchema(dataSource);
		for (const [index, root] of publicRoots.entries()) {
			await insertRoot(root, root, (index + 2) * 64 - 1, false);
		}
		await insertRoot(publicRoots[0], legacyIdentity, 63, true);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('uses displayed identities for every coverage field while retaining case-distinct paths, schemes and listener roots', async () => {
		const coverage = await getCheckpointCoverage(
			dataSource.manager,
			null,
			'public-sources'
		);
		const [sourceCount] = await dataSource.query(sourceCountSql);
		expect(sourceCount.sourceCount).toBe(5);
		expect(coverage).toMatchObject({
			archiveRootsWithState: 5,
			expectedArchiveCheckpoints: 20,
			totalArchiveCheckpoints: 10,
			activeArchiveCheckpoints: 5,
			durableVerifiedArchiveCheckpoints: 10,
			categoryConsistentArchiveCheckpoints: 5,
			categoryConsistencyPendingCheckpoints: 5,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			completeArchiveCheckpoints: 5,
			objectCompleteArchiveCheckpoints: 5,
			failedArchiveCheckpoints: 0,
			partialArchiveCheckpoints: 5,
			missingArchiveCheckpoints: 10,
			discoveryCompleteArchiveRoots: 1,
			oldestCheckpointLedger: 63,
			latestCheckpointLedger: 127
		});
	});

	it('preserves explicit legacy forensic reads and unfiltered evidence totals without deleting or merging rows', async () => {
		const legacy = await getCheckpointCoverage(
			dataSource.manager,
			legacyIdentity
		);
		expect(legacy).toMatchObject({
			archiveRootsWithState: 1,
			expectedArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 50,
			activeArchiveCheckpoints: 1,
			durableVerifiedArchiveCheckpoints: 25,
			categoryConsistentArchiveCheckpoints: 10,
			categoryConsistencyFailedCheckpoints: 10,
			categoryConsistencyNotEvaluatedCheckpoints: 10,
			categoryConsistencyPendingCheckpoints: 20,
			latestCheckpointLedger: 3199
		});
		const all = await getCheckpointCoverage(dataSource.manager, null);
		expect(all).toMatchObject({
			archiveRootsWithState: 6,
			expectedArchiveCheckpoints: 21,
			totalArchiveCheckpoints: 60,
			activeArchiveCheckpoints: 6,
			durableVerifiedArchiveCheckpoints: 35
		});
	});

	async function insertRoot(
		url: string,
		identity: string,
		currentLedger: number,
		legacy: boolean
	): Promise<void> {
		await dataSource.query(
			`
			insert into history_archive_state_snapshot
				("archiveUrl", "archiveUrlIdentity", status, "currentLedger")
			values ($1, $2, 'available', $3)
		`,
			[url, identity, currentLedger]
		);
		await dataSource.query(
			`
			insert into history_archive_object_queue
				("archiveUrlIdentity", status, "checkpointLedger")
			values ($1, 'scanning', 63)
		`,
			[identity]
		);
		await dataSource.query(
			`
			insert into history_archive_checkpoint_proof_rollup values
				($1, $2, $3, $4, $5, $5, $4, 63, $6)
		`,
			[
				identity,
				legacy ? 50 : 2,
				legacy ? 20 : 1,
				legacy ? 10 : 1,
				legacy ? 10 : 0,
				legacy ? 3199 : 127
			]
		);
		await dataSource.query(
			`
			insert into history_archive_checkpoint_proof_version_rollup
			select *, $2 from history_archive_checkpoint_proof_rollup
			where "archiveUrlIdentity" = $1
		`,
			[identity, CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION]
		);
		await dataSource.query(
			`
			insert into history_archive_checkpoint_proof_attestation_rollup
				values ($1, $2)
		`,
			[identity, legacy ? 25 : 2]
		);
	}
});

async function createSchema(dataSource: DataSource): Promise<void> {
	// Deliberately no raw checkpoint-proof table: public totals must use rollups.
	await dataSource.query(`
		create table history_archive_state_snapshot (
			"archiveUrl" text not null, "archiveUrlIdentity" text primary key,
			status text not null, "currentLedger" integer
		);
		create table history_archive_object_queue (
			"archiveUrlIdentity" text not null, status text not null,
			"checkpointLedger" integer
		);
		create index coverage_active_checkpoints
			on history_archive_object_queue (status, "archiveUrlIdentity", "checkpointLedger");
		create table history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity" text primary key,
			"totalCheckpointProofs" bigint not null,
			"pendingCheckpointProofs" bigint not null,
			"verifiedCheckpointProofs" bigint not null,
			"mismatchCheckpointProofs" bigint not null,
			"notEvaluableCheckpointProofs" bigint not null,
			"objectCompleteCheckpointProofs" bigint not null,
			"oldestCheckpointLedger" integer,
			"latestCheckpointLedger" integer
		);
		create table history_archive_checkpoint_proof_version_rollup (
			like history_archive_checkpoint_proof_rollup including all,
			"proofVersion" integer not null
		);
		create table history_archive_checkpoint_proof_attestation_rollup (
			"archiveUrlIdentity" text primary key,
			"durableVerifiedCheckpointProofs" bigint not null
		);
	`);
}
