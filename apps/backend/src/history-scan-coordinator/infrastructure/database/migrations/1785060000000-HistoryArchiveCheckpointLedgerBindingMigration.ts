import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createFullHistoryBatchProofExactTimestampFunctionSql } from './FullHistoryCanonicalSchemaSql.js';

const failureConstraint = 'CHK_history_archive_checkpoint_proof_failure';
const replacementConstraint = `${failureConstraint}_v6`;
const migrationBatchSize = 25;

export class HistoryArchiveCheckpointLedgerBindingMigration1785060000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveCheckpointLedgerBindingMigration1785060000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set lock_timeout = '2s'`);
		await queryRunner.query(`set statement_timeout = '30s'`);
		try {
			await this.assertCanonicalProofBindings(queryRunner);
			await this.replaceFailureConstraint(queryRunner);
			await queryRunner.query(
				createFullHistoryBatchProofExactTimestampFunctionSql
			);
			await this.backfillVerifiedProofs(queryRunner);
		} finally {
			await queryRunner.query('reset statement_timeout');
			await queryRunner.query('reset lock_timeout');
		}
	}

	private async assertCanonicalProofBindings(
		queryRunner: QueryRunner
	): Promise<void> {
		const rows = (await queryRunner.query(`
			select count(*)::integer as count
			from full_history_ingestion_batch batch
			join history_archive_checkpoint_proof proof
				on proof.id = batch."checkpoint_proof_id"
			left join history_archive_object_queue state
				on state."remoteId" = proof."checkpointStateObjectRemoteId"
				and state."objectType" = 'checkpoint-state'
			left join lateral (
				select case when state."verificationFacts"#>>
					'{checkpointHistoryArchiveStateFact,checkpointLedger}' ~ '^[0-9]+$'
				then (state."verificationFacts"#>>
					'{checkpointHistoryArchiveStateFact,checkpointLedger}')::bigint
				end as payload_checkpoint_ledger
			) fact on true
			where state.status is distinct from 'verified'
				or fact.payload_checkpoint_ledger is null
				or fact.payload_checkpoint_ledger <> proof."checkpointLedger"
		`)) as readonly { readonly count: number }[];
		if ((rows[0]?.count ?? 0) > 0) {
			throw new Error(
				'Canonical full-history batches reference checkpoint proofs without an exact checkpoint-state ledger binding'
			);
		}
	}

	private async replaceFailureConstraint(
		queryRunner: QueryRunner
	): Promise<void> {
		await queryRunner.query(`
			alter table history_archive_checkpoint_proof
			drop constraint if exists "${replacementConstraint}"
		`);
		await queryRunner.query(`
			alter table history_archive_checkpoint_proof
			add constraint "${replacementConstraint}" check (
				"failureKind" is null or "failureKind" in (
					'object-incomplete', 'object-failed', 'proof-facts-incomplete',
					'checkpoint-ledger-mismatch',
					'checkpoint-bucket-list-mismatch', 'transaction-hash-mismatch',
					'result-hash-mismatch', 'previous-ledger-hash-mismatch',
					'predecessor-missing', 'bucket-missing'
				)
			) not valid
		`);
		await queryRunner.query(`
			alter table history_archive_checkpoint_proof
			validate constraint "${replacementConstraint}"
		`);
		await queryRunner.query(`
			alter table history_archive_checkpoint_proof
			drop constraint if exists "${failureConstraint}"
		`);
		await queryRunner.query(`
			alter table history_archive_checkpoint_proof
			rename constraint "${replacementConstraint}" to "${failureConstraint}"
		`);
	}

	private async backfillVerifiedProofs(
		queryRunner: QueryRunner
	): Promise<void> {
		while (true) {
			const result: unknown = await queryRunner.query(`
				with candidates as (
					select proof.id
					from history_archive_checkpoint_proof proof
					where proof.status = 'verified' and proof."proofVersion" < 6
					order by proof.id
					limit ${migrationBatchSize}
					for update skip locked
				), state_fact as materialized (
				select proof.id, state."remoteId" as state_remote_id,
					case when state."verificationFacts"#>>
						'{checkpointHistoryArchiveStateFact,checkpointLedger}' ~ '^[0-9]+$'
					then (state."verificationFacts"#>>
						'{checkpointHistoryArchiveStateFact,checkpointLedger}')::bigint
					end as payload_checkpoint_ledger
				from history_archive_checkpoint_proof proof
				join candidates on candidates.id = proof.id
				left join history_archive_object_queue state
					on state."remoteId" = proof."checkpointStateObjectRemoteId"
					and state."objectType" = 'checkpoint-state'
					and state.status = 'verified'
				), failed_state as (
					update history_archive_object_queue state
					set status = 'failed', "verifiedAt" = null,
						"workerStage" = 'failed',
						"errorType" = 'checkpoint_state_ledger_mismatch',
						"errorMessage" = 'Checkpoint state declares ledger ' ||
							fact.payload_checkpoint_ledger::text || '; expected ' ||
							proof."checkpointLedger"::text,
						"failureChannel" = 'archive_evidence', "httpStatus" = null,
						"nextAttemptAt" = now(), "claimedAt" = null,
						"claimedByCommunityScannerId" = null,
						"transitionEffectsCompletedAt" = null,
						"transitionEffectsRequiredAt" = now(), "updatedAt" = now()
					from state_fact fact
					join history_archive_checkpoint_proof proof on proof.id = fact.id
					where state."remoteId" = fact.state_remote_id
						and fact.payload_checkpoint_ledger is not null
						and fact.payload_checkpoint_ledger <> proof."checkpointLedger"
					returning state."remoteId"
			)
			update history_archive_checkpoint_proof proof
			set "proofVersion" = 6,
				status = case
					when fact.payload_checkpoint_ledger is not null
						and fact.payload_checkpoint_ledger <> proof."checkpointLedger"
						then 'not-evaluable'
					when fact.payload_checkpoint_ledger is null
						and proof.status = 'verified' then 'not-evaluable'
					else proof.status
				end,
				"proofFactsComplete" = case
					when fact.payload_checkpoint_ledger is null
						or fact.payload_checkpoint_ledger <> proof."checkpointLedger"
						then false
					else proof."proofFactsComplete"
				end,
				"failureKind" = case
					when fact.payload_checkpoint_ledger is not null
						and fact.payload_checkpoint_ledger <> proof."checkpointLedger"
						then 'object-failed'
					when fact.payload_checkpoint_ledger is null
						and proof.status = 'verified' then 'proof-facts-incomplete'
					else proof."failureKind"
				end,
				details = coalesce(proof.details, '{}'::jsonb) || jsonb_build_object(
					'checkpointStateLedgerFactPresent',
						fact.payload_checkpoint_ledger is not null,
					'checkpointStateLedgerMatches',
						coalesce(fact.payload_checkpoint_ledger = proof."checkpointLedger", false),
					'checkpointStateLedgerExpected', proof."checkpointLedger",
					'checkpointStateLedgerObserved', fact.payload_checkpoint_ledger,
					'checkpointStateObjectRemoteId', proof."checkpointStateObjectRemoteId"
				),
				"evaluatedAt" = now(),
				"updatedAt" = now()
			from state_fact fact
			where proof.id = fact.id
			returning proof.id
			`);
			const rows = readReturnedRows(result);
			if (rows.length === 0) return;
		}
	}

	async down(_queryRunner: QueryRunner): Promise<void> {
		// Proof corrections are durable evidence and are not reversed.
	}
}

function readReturnedRows(value: unknown): readonly { readonly id: number }[] {
	if (!Array.isArray(value)) return [];
	const records: unknown = Array.isArray(value[0]) ? value[0] : value;
	if (!Array.isArray(records)) return [];
	return records.filter(isIdRow);
}

function isIdRow(value: unknown): value is { readonly id: number } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		typeof value.id === 'number'
	);
}
