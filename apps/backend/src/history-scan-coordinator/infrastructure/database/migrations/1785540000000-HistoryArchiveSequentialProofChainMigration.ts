import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveSequentialProofChainMigration1785540000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveSequentialProofChainMigration1785540000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
            update "history_archive_checkpoint_scan_cursor"
            set "lastForwardCheckpointLedger" = null,
                "nextHistoricalCheckpointLedger" = 63,
                "updatedAt" = now()
        `);
		await queryRunner.query(`
            update "history_archive_object_queue" checkpoint
            set "descendantsPlannedAt" = null,
                "updatedAt" = now()
            where checkpoint."objectType" = 'checkpoint-state'
                and checkpoint."checkpointLedger" = 63
                and checkpoint.status = 'verified'
                and not exists (
                    select 1
                    from "history_archive_checkpoint_proof" proof
                    where proof."archiveUrlIdentity" =
                            checkpoint."archiveUrlIdentity"
                        and proof."checkpointLedger" = 63
                        and proof.status = 'verified'
                )
        `);
	}

	async down(): Promise<void> {
		throw new Error(
			'Sequential proof-chain admission is forward-only because reversing it would reopen sparse historical work'
		);
	}
}
