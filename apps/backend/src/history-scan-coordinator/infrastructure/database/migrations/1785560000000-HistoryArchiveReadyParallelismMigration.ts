import type { MigrationInterface, QueryRunner } from 'typeorm';

const legacyPriorityLaneIndex =
        'history_archive_object_ready_archive_priority_key';
const parallelLaneIndex =
        'history_archive_object_ready_archive_priority_idx';

export class HistoryArchiveReadyParallelismMigration1785560000000
        implements MigrationInterface
{
        readonly name = 'HistoryArchiveReadyParallelismMigration1785560000000';
        readonly transaction = false;

        async up(queryRunner: QueryRunner): Promise<void> {
                await queryRunner.query(`set lock_timeout = '2min'`);
                await queryRunner.query(`set statement_timeout = 0`);
                try {
                        await queryRunner.query(
                                `drop index concurrently if exists "${legacyPriorityLaneIndex}"`
                        );
                        await queryRunner.query(`
                                create index concurrently if not exists
                                        "${parallelLaneIndex}"
                                on "history_archive_object_ready" (
                                        "archiveUrlIdentity", priority
                                )
                        `);
                } finally {
                        await queryRunner.query(`set statement_timeout = default`);
                        await queryRunner.query(`set lock_timeout = default`);
                }
        }

        async down(queryRunner: QueryRunner): Promise<void> {
                await queryRunner.query(`set lock_timeout = '2min'`);
                await queryRunner.query(`set statement_timeout = 0`);
                try {
                        const duplicateLanes = (await queryRunner.query(`
                                select 1
                                from "history_archive_object_ready"
                                group by "archiveUrlIdentity", priority
                                having count(*) > 1
                                limit 1
                        `)) as readonly unknown[];
                        if (duplicateLanes.length > 0) {
                                throw new Error(
                                        'cannot restore single-object archive priority lanes while parallel work is queued'
                                );
                        }
                        await queryRunner.query(
                                `drop index concurrently if exists "${parallelLaneIndex}"`
                        );
                        await queryRunner.query(`
                                create unique index concurrently if not exists
                                        "${legacyPriorityLaneIndex}"
                                on "history_archive_object_ready" (
                                        "archiveUrlIdentity", priority
                                )
                        `);
                } finally {
                        await queryRunner.query(`set statement_timeout = default`);
                        await queryRunner.query(`set lock_timeout = default`);
                }
        }
}
