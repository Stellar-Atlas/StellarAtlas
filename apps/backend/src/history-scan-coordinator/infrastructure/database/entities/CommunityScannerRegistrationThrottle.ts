import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	UpdateDateColumn
} from 'typeorm';

@Entity('community_scanner_registration_throttles')
@Index('idx_community_scanner_registration_throttles_updated_at', ['updatedAt'])
export class CommunityScannerRegistrationThrottle {
	@PrimaryColumn({ name: 'source_ip_hash', type: 'char', length: 64 })
	sourceIpHash!: string;

	@Column({ name: 'window_started_at', type: 'timestamptz' })
	windowStartedAt!: Date;

	@Column({ name: 'attempt_count', type: 'integer', default: 0 })
	attemptCount: number = 0;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt!: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt!: Date;
}
