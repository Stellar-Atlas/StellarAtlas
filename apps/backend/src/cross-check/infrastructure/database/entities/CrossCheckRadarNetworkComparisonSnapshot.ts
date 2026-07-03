import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn
} from 'typeorm';
import type {
	CrossCheckRadarNetworkSnapshotFailureDTO,
	CrossCheckRadarNetworkSnapshotStatus
} from '@cross-check/domain/CrossCheckRadarNetworkSnapshot.js';
import type { CrossCheckRadarNetworkComparisonDTO } from '@cross-check/domain/CrossCheckRadarNetworkComparison.js';

@Entity('cross_check_radar_network_comparison_snapshots')
@Check(
	'CHK_cross_check_radar_network_snapshots_status',
	`"status" IN ('compared', 'failed')`
)
@Check(
	'CHK_cross_check_radar_network_snapshots_payload',
	`("status" = 'compared' AND "comparison" IS NOT NULL AND "failure" IS NULL)
	OR ("status" = 'failed' AND "comparison" IS NULL AND "failure" IS NOT NULL)`
)
@Index('idx_cross_check_radar_network_snapshots_latest', [
	'generatedAt',
	'storedAt',
	'id'
])
@Index('idx_cross_check_radar_network_status_generated_at', [
	'status',
	'generatedAt'
])
export class CrossCheckRadarNetworkComparisonSnapshot {
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	@Column({ type: 'varchar', length: 32 })
	status!: CrossCheckRadarNetworkSnapshotStatus;

	@Column({ name: 'generated_at', type: 'timestamptz' })
	generatedAt!: Date;

	@Column({ type: 'jsonb', nullable: true })
	comparison!: CrossCheckRadarNetworkComparisonDTO | null;

	@Column({ type: 'jsonb', nullable: true })
	failure!: CrossCheckRadarNetworkSnapshotFailureDTO | null;

	@CreateDateColumn({ name: 'stored_at', type: 'timestamptz' })
	storedAt!: Date;
}
