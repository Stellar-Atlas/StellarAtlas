import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import {
	fullHistoryHashTransformer,
	fullHistoryUint64Transformer,
	FullHistoryHash,
	type FullHistoryUint64String
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_watermark' })
export class FullHistoryWatermark {
	@PrimaryColumn('bytea', {
		name: 'network_passphrase_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly networkPassphraseHash!: FullHistoryHash;

	@Column('bigint', {
		name: 'next_ledger',
		transformer: fullHistoryUint64Transformer
	})
	readonly nextLedger!: FullHistoryUint64String;

	@Column('uuid', { name: 'last_batch_id', unique: true })
	readonly lastBatchId!: string;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	readonly updatedAt!: Date;
}
