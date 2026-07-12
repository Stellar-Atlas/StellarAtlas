import { Column, Entity, PrimaryColumn } from 'typeorm';
import type {
	FullHistoryOperationOutcome,
	FullHistoryOperationResultCode,
	FullHistoryOperationResultFactScope
} from '../../../../domain/full-history/FullHistoryCanonicalOperationResult.js';
import {
	fullHistoryHashTransformer,
	FullHistoryHash
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_operation_result' })
export class FullHistoryOperationResult {
	@PrimaryColumn('bytea', {
		name: 'network_passphrase_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly networkPassphraseHash!: FullHistoryHash;

	@PrimaryColumn('bytea', {
		name: 'transaction_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly transactionHash!: FullHistoryHash;

	@PrimaryColumn('integer', { name: 'operation_index' })
	readonly operationIndex!: number;

	@Column('text')
	readonly outcome!: FullHistoryOperationOutcome;

	@Column('integer', { name: 'operation_result_code', nullable: true })
	readonly operationResultCode!: FullHistoryOperationResultCode | null;

	@Column('integer', {
		name: 'operation_specific_result_code',
		nullable: true
	})
	readonly operationSpecificResultCode!: number | null;

	@Column('text', { name: 'fact_scope' })
	readonly factScope!: FullHistoryOperationResultFactScope;
}
