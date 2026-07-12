import type { MigrationInterface, QueryRunner } from 'typeorm';

const measurementIndexName = 'idx_node_measurement_latest_by_node';
const snapshotIndexName = 'idx_node_snapshot_latest_by_node';

export class NodeReadPathIndexesMigration1784990000000 implements MigrationInterface {
	readonly name = 'NodeReadPathIndexesMigration1784990000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${measurementIndexName}"
			on "node_measurement_v2" ("nodeId", "time" desc)
		`);
		await queryRunner.query(`
			create index concurrently if not exists "${snapshotIndexName}"
			on "node_snap_shot" ("NodeId", "endDate" desc)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`drop index concurrently if exists "${snapshotIndexName}"`
		);
		await queryRunner.query(
			`drop index concurrently if exists "${measurementIndexName}"`
		);
	}
}
