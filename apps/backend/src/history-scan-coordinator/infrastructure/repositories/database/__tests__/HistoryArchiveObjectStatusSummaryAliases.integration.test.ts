import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { getHistoryArchiveObjectStatusSummary } from '../HistoryArchiveObjectStatusSummaryQuery.js';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import {
	createEvidenceSummarySchema,
	populateEvidenceSummary
} from './HistoryArchiveObjectStatusSummaryScaleFixture.js';

jest.setTimeout(60_000);

describe('history archive status summary aliases', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createSchema(dataSource);
		await createFixture(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('excludes poisoned legacy identities without merging current case-distinct roots or failures', async () => {
		const summary = await getHistoryArchiveObjectStatusSummary(
			dataSource.manager,
			new Date('2026-07-12T19:00:00.000Z')
		);

		expect(summary.sourceCount).toBe(4);
		expect(summary.sources).toHaveLength(4);
		expect(
			summary.sources.map((source) => source.archiveUrlIdentity)
		).not.toContain(legacyIdentity);
		expect(summary.sources.map((source) => source.archiveUrl)).toEqual(
			expect.arrayContaining([
				duplicateRoot,
				caseDistinctRoot,
				caseDistinctLowerRoot,
				schemeDistinctRoot
			])
		);

		const merged = summary.sources.find(
			(source) => source.archiveUrl === duplicateRoot
		);
		expect(merged).toMatchObject({
			activeObjectChecks: 2,
			archiveEvidenceFailures: 2,
			archiveUrlIdentity: duplicateRoot,
			latestDiscoveredCheckpointLedger: 255,
			observedAt: '2026-07-12T18:00:00.000Z',
			pendingCheckpointProofs: 2,
			verifiedCheckpointProofs: 1,
			durableVerifiedCheckpointProofs: 1,
			scannerIssueFailures: 1,
			totalCheckpointProofs: 4
		});
		expect(
			summary.sources.find(
				(source) => source.archiveUrl === caseDistinctLowerRoot
			)?.unclassifiedFailures
		).toBe(1);
		expect(summary.archiveEvidenceFailures).toBe(2);
		expect(summary.scannerIssueFailures).toBe(1);
		expect(summary.unclassifiedFailures).toBe(1);
		expect(summary.checkpointCoverage.totalArchiveCheckpoints).toBe(4);
		expect(
			summary.checkpointCoverage.categoryConsistentArchiveCheckpoints
		).toBe(1);
	});

	it('rejects an incomplete evidence rollup instead of returning partial totals', async () => {
		await dataSource.query(`
			update history_archive_evidence_root_summary_progress
			set "complete" = false
			where id = 1
		`);
		try {
			await expect(
				getHistoryArchiveObjectStatusSummary(dataSource.manager)
			).rejects.toThrow('Archive evidence summaries are not ready');
		} finally {
			await dataSource.query(`
				update history_archive_evidence_root_summary_progress
				set "complete" = true
				where id = 1
			`);
		}
	});
});

const duplicateRoot = 'https://history.example/ArchiveA';
const legacyIdentity = 'https://history.example/archivea';
const caseDistinctRoot = 'https://history.example/CaseRoot';
const caseDistinctLowerRoot = 'https://history.example/caseroot';
const schemeDistinctRoot = 'http://history.example/ArchiveA';

async function createSchema(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table history_archive_state_snapshot (
			"archiveUrl" text not null,
			"archiveUrlIdentity" text primary key,
			"stateUrl" text not null,
			status text not null,
			"observedAt" timestamptz not null,
			source text not null,
			"currentLedger" integer
		)
	`);
	await dataSource.query(`
		create table history_archive_object_queue (
			id bigserial primary key,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			status text not null,
			"checkpointLedger" integer,
			"failureChannel" text,
			"transitionEffectsRequiredAt" timestamptz,
			"transitionEffectsCompletedAt" timestamptz,
			"updatedAt" timestamptz not null
		)
	`);
	await dataSource.query(`
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
		)
	`);
	await createEvidenceSummarySchema(dataSource);
	await dataSource.query(`
		alter table history_archive_evidence_root_summary_progress
			add column "lastObjectId" bigint not null default 0,
			add column "cutoffObjectId" bigint not null default 0;
		create table history_archive_checkpoint_proof_rollup_progress (
			id smallint primary key, "complete" boolean not null,
			"lastProofId" bigint not null, "cutoffProofId" bigint not null
		)
	`);
	await dataSource.query(`
		create table history_archive_checkpoint_proof_version_rollup (
			"archiveUrlIdentity" text not null,
			"proofVersion" integer not null,
			"totalCheckpointProofs" bigint not null,
			"pendingCheckpointProofs" bigint not null,
			"verifiedCheckpointProofs" bigint not null,
			"mismatchCheckpointProofs" bigint not null,
			"notEvaluableCheckpointProofs" bigint not null,
			"objectCompleteCheckpointProofs" bigint not null,
			primary key ("archiveUrlIdentity", "proofVersion")
		);
		create table history_archive_checkpoint_proof_attestation_rollup (
			"archiveUrlIdentity" text primary key,
			"durableVerifiedCheckpointProofs" bigint not null
		)
	`);
}

async function createFixture(dataSource: DataSource): Promise<void> {
	await insertState(
		dataSource,
		duplicateRoot,
		legacyIdentity,
		'2026-07-12T00:00:00.000Z',
		127
	);
	await insertState(
		dataSource,
		duplicateRoot,
		duplicateRoot,
		'2026-07-12T18:00:00.000Z',
		319
	);
	await insertState(
		dataSource,
		caseDistinctRoot,
		caseDistinctRoot,
		'2026-07-12T17:00:00.000Z',
		255
	);
	await insertState(
		dataSource,
		caseDistinctLowerRoot,
		caseDistinctLowerRoot,
		'2026-07-12T17:00:00.000Z',
		255
	);
	await insertState(
		dataSource,
		schemeDistinctRoot,
		schemeDistinctRoot,
		'2026-07-12T17:00:00.000Z',
		255
	);

	await dataSource.query(
		`
			insert into history_archive_object_queue (
				"archiveUrlIdentity", "objectType", status, "checkpointLedger",
				"failureChannel", "updatedAt"
			) values
				($1, 'history-archive-state', 'verified', null, null, $6),
				($2, 'history-archive-state', 'verified', null, null, $7),
				($3, 'history-archive-state', 'verified', null, null, $7),
				($4, 'history-archive-state', 'verified', null, null, $7),
				($5, 'history-archive-state', 'verified', null, null, $7),
				($2, 'ledger', 'scanning', 63, null, $7),
				($2, 'ledger', 'scanning', 127, null, $7),
				($2, 'ledger', 'failed', 63, 'archive_evidence', $7),
				($1, 'ledger', 'failed', 63, 'archive_evidence', $6),
				($2, 'transactions', 'failed', 127, 'archive_evidence', $7),
				($2, 'results', 'failed', 127, 'scanner_issue', $7),
				($4, 'ledger', 'failed', 63, null, $7)
		`,
		[
			legacyIdentity,
			duplicateRoot,
			caseDistinctRoot,
			caseDistinctLowerRoot,
			schemeDistinctRoot,
			'2026-07-12T00:00:00.000Z',
			'2026-07-12T18:00:00.000Z'
		]
	);
	await dataSource.query(
		`
			insert into history_archive_checkpoint_proof_rollup (
				"archiveUrlIdentity", "totalCheckpointProofs",
				"pendingCheckpointProofs", "verifiedCheckpointProofs",
				"mismatchCheckpointProofs", "notEvaluableCheckpointProofs",
				"objectCompleteCheckpointProofs", "oldestCheckpointLedger",
				"latestCheckpointLedger"
			) values
				($1, 1, 1, 0, 0, 0, 0, 63, 63),
				($2, 4, 2, 1, 0, 1, 1, 63, 255)
		`,
		[legacyIdentity, duplicateRoot]
	);
	// Current counters belong to the exact advertised identity; the historical
	// lowercase row and its old-version proof remain deliberately present but excluded.
	await dataSource.query(
		`
		insert into history_archive_checkpoint_proof_version_rollup
		select "archiveUrlIdentity", case when "archiveUrlIdentity" = $1 then $2::integer else $2::integer - 1 end,
			"totalCheckpointProofs", "pendingCheckpointProofs", "verifiedCheckpointProofs",
			"mismatchCheckpointProofs", "notEvaluableCheckpointProofs", "objectCompleteCheckpointProofs"
		from history_archive_checkpoint_proof_rollup
	`,
		[duplicateRoot, CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION]
	);
	await dataSource.query(
		`
		insert into history_archive_checkpoint_proof_attestation_rollup values ($1, 1)
	`,
		[duplicateRoot]
	);
	await populateEvidenceSummary(dataSource);
	await dataSource.query(`
		update history_archive_evidence_root_summary_progress
		set "lastObjectId" = (select max(id) from history_archive_object_queue),
			"cutoffObjectId" = (select max(id) from history_archive_object_queue)
		where id = 1;
		insert into history_archive_checkpoint_proof_rollup_progress
		select 1, true, sum("totalCheckpointProofs"), sum("totalCheckpointProofs")
		from history_archive_checkpoint_proof_rollup
	`);
}

async function insertState(
	dataSource: DataSource,
	archiveUrl: string,
	archiveUrlIdentity: string,
	observedAt: string,
	currentLedger: number
): Promise<void> {
	await dataSource.query(
		`
			insert into history_archive_state_snapshot (
				"archiveUrl", "archiveUrlIdentity", "stateUrl", status,
				"observedAt", source, "currentLedger"
			) values ($1, $2, $1 || '/.well-known/stellar-history.json',
				'available', $3, 'network-scan', $4)
		`,
		[archiveUrl, archiveUrlIdentity, observedAt, currentLedger]
	);
}
