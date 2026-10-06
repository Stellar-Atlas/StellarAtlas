import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createHistoryArchiveBrokerRecoveryCandidateIndex,
	historyArchiveBrokerRecoveryCandidateIndexName
} from '../../repositories/database/HistoryArchiveBrokerRecoveryAdmissionSql.js';

/** Additive scheduling-only index. Never relocate or index the durable queue. */
export class HistoryArchiveBrokerRecoveryCandidateIndexMigration1791310800000 implements MigrationInterface {
	name = 'HistoryArchiveBrokerRecoveryCandidateIndexMigration1791310800000';
	transaction = false;
	async up(queryRunner: QueryRunner): Promise<void> {
		const [location] = (await queryRunner.query(`select space.spcname
			from pg_class relation join pg_database database on database.datname=current_database()
			join pg_tablespace space on space.oid=coalesce(nullif(relation.reltablespace,0),database.dattablespace)
			where relation.oid='history_archive_broker_candidate'::regclass`)) as {
			spcname: string;
		}[];
		const tablespace =
			process.env.HISTORY_ARCHIVE_BROKER_CANDIDATE_TABLESPACE ??
			location?.spcname;
		if (tablespace === undefined)
			throw new Error('Missing broker candidate tablespace');
		await queryRunner.query(
			createHistoryArchiveBrokerRecoveryCandidateIndex(tablespace)
		);
		const [index] = (await queryRunner.query(
			`select index.indisvalid,index.indisready,
			index.indrelid='history_archive_broker_candidate'::regclass as correct_table,
			space.spcname
			from pg_class relation join pg_index index on index.indexrelid=relation.oid
			join pg_database database on database.datname=current_database()
			join pg_tablespace space on space.oid=coalesce(nullif(relation.reltablespace,0),database.dattablespace)
			where relation.oid=to_regclass($1)`,
			[historyArchiveBrokerRecoveryCandidateIndexName]
		)) as {
			indisvalid: boolean;
			indisready: boolean;
			correct_table: boolean;
			spcname: string;
		}[];
		if (
			!index?.indisvalid ||
			!index.indisready ||
			!index.correct_table ||
			index.spcname !== tablespace
		)
			throw new Error(
				'Broker recovery candidate index is absent, invalid, or misplaced'
			);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`drop index concurrently if exists ${historyArchiveBrokerRecoveryCandidateIndexName}`
		);
	}
}
