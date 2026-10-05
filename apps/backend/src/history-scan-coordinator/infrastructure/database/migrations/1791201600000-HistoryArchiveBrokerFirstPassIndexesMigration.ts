import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createHistoryArchiveBrokerFirstPassIndexes } from '../../repositories/database/HistoryArchiveBrokerFirstPassAdmissionSql.js';

/** Scheduling indexes only. Concurrent installation must not block completion
 * writers, and each index inherits its table's actual tablespace, not the
 * database's default (which may be slower storage). */
export class HistoryArchiveBrokerFirstPassIndexesMigration1791201600000 implements MigrationInterface {
	name = 'HistoryArchiveBrokerFirstPassIndexesMigration1791201600000';
	transaction = false;
	async up(queryRunner: QueryRunner): Promise<void> {
		const locations =
			(await queryRunner.query(`select relation.relname,space.spcname
			from pg_class relation join pg_database database on database.datname=current_database()
			join pg_tablespace space on space.oid=coalesce(nullif(relation.reltablespace,0),database.dattablespace)
			where relation.oid in ('history_archive_broker_candidate'::regclass,'history_archive_object_ready'::regclass)`)) as {
				relname: string;
				spcname: string;
			}[];
		for (const [index, table] of [
			'history_archive_broker_candidate',
			'history_archive_broker_candidate',
			'history_archive_object_ready',
			'history_archive_object_ready'
		].entries()) {
			const tablespace =
				process.env.HISTORY_ARCHIVE_BROKER_CANDIDATE_TABLESPACE ??
				locations.find((location) => location.relname === table)?.spcname;
			if (tablespace === undefined)
				throw new Error(`Missing tablespace for ${table}`);
			await queryRunner.query(
				createHistoryArchiveBrokerFirstPassIndexes(tablespace)[index]!
			);
		}
		const invalid =
			(await queryRunner.query(`select relation.relname from pg_class relation
			join pg_index index on index.indexrelid=relation.oid where relation.relname in
			('history_archive_candidate_fresh_order','history_archive_candidate_recovery_scope',
			'history_archive_ready_root_oldest','history_archive_ready_manual_recheck')
			and (not index.indisvalid or not index.indisready)`)) as { relname: string }[];
		if (invalid.length > 0)
			throw new Error(
				`Incomplete broker first-pass indexes: ${invalid.map((index) => index.relname).join(', ')}`
			);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		for (const index of [
			'history_archive_candidate_fresh_order',
			'history_archive_candidate_recovery_scope',
			'history_archive_ready_root_oldest',
			'history_archive_ready_manual_recheck'
		]) {
			await queryRunner.query(`drop index concurrently if exists ${index}`);
		}
	}
}
