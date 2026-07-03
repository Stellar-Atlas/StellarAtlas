import {
	Check,
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn
} from 'typeorm';
import type {
	CrossCheckApiDocsSnapshotFailureDTO,
	CrossCheckApiDocsSnapshotStatus
} from '@cross-check/domain/CrossCheckApiDocsSnapshot.js';
import type { CrossCheckApiDocsComparisonDTO } from '@cross-check/domain/CrossCheckApiDocsComparison.js';

@Entity('cross_check_api_docs_comparison_snapshots')
@Check(
	'CHK_cross_check_api_docs_snapshots_status',
	`"status" IN ('compared', 'failed')`
)
@Check(
	'CHK_cross_check_api_docs_snapshots_payload',
	`("status" = 'compared' AND "comparison" IS NOT NULL AND "failure" IS NULL)
	OR ("status" = 'failed' AND "comparison" IS NULL AND "failure" IS NOT NULL)`
)
@Index('idx_cross_check_api_docs_snapshots_latest', [
	'generatedAt',
	'storedAt',
	'id'
])
@Index('idx_cross_check_api_docs_snapshots_status_generated_at', [
	'status',
	'generatedAt'
])
export class CrossCheckApiDocsComparisonSnapshot {
	@PrimaryGeneratedColumn('uuid')
	id!: string;

	@Column({ type: 'varchar', length: 32 })
	status!: CrossCheckApiDocsSnapshotStatus;

	@Column({ name: 'generated_at', type: 'timestamptz' })
	generatedAt!: Date;

	@Column({ type: 'jsonb', nullable: true })
	comparison!: CrossCheckApiDocsComparisonDTO | null;

	@Column({ type: 'jsonb', nullable: true })
	failure!: CrossCheckApiDocsSnapshotFailureDTO | null;

	@CreateDateColumn({ name: 'stored_at', type: 'timestamptz' })
	storedAt!: Date;
}
