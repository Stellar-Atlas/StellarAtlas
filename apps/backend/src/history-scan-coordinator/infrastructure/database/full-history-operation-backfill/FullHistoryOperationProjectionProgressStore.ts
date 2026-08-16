import type { EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	assertBoundedText,
	assertInteger
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface ProjectionProgressRow {
	readonly decoderVersion: string;
	readonly expectedCount: number;
	readonly nextOffset: number;
}

interface ProjectionProgressAdvanceRow {
	readonly nextOffset: number | null;
	readonly updatedCount: number;
}

const accountReferenceProjection = 'operation-account-reference';

export async function lockOperationAccountReferenceProgress(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite
): Promise<ProjectionProgressRow> {
	const expectedCount = input.operationAccountReferences.length;
	const decoderVersion = assertBoundedText(
		input.operationAccountReferenceDecoderVersion,
		'operationAccountReferenceDecoderVersion',
		128
	);
	await manager.query(
		`insert into "full_history_operation_projection_progress" (
			"batch_id", "projection", "decoder_version", "expected_count"
		) values ($1, $2, $3, $4)
		on conflict ("batch_id", "projection") do nothing`,
		[input.batchId, accountReferenceProjection, decoderVersion, expectedCount]
	);
	const rows = await manager.query<ProjectionProgressRow[]>(
		`select
			"decoder_version" as "decoderVersion",
			"expected_count" as "expectedCount",
			"next_offset" as "nextOffset"
		from "full_history_operation_projection_progress"
		where "batch_id" = $1 and "projection" = $2
		for update`,
		[input.batchId, accountReferenceProjection]
	);
	const progress = rows[0];
	if (
		progress === undefined ||
		progress.decoderVersion !== decoderVersion ||
		progress.expectedCount !== expectedCount
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Operation account-reference progress does not match the decoded batch'
		);
	}
	return {
		...progress,
		nextOffset: assertInteger(
			progress.nextOffset,
			'operationAccountReferenceNextOffset',
			0,
			expectedCount
		)
	};
}

export async function advanceOperationAccountReferenceProgress(
	manager: EntityManager,
	batchId: string,
	currentOffset: number,
	nextOffset: number
): Promise<void> {
	const rows = await manager.query<ProjectionProgressAdvanceRow[]>(
		`with updated as (
			update "full_history_operation_projection_progress"
			set "next_offset" = $4, "updated_at" = now()
			where "batch_id" = $1
				and "projection" = $2
				and "next_offset" = $3
			returning "next_offset"
		)
		select count(*)::integer as "updatedCount",
			max("next_offset")::integer as "nextOffset"
		from updated`,
		[batchId, accountReferenceProjection, currentOffset, nextOffset]
	);
	if (
		rows.length !== 1 ||
		rows[0]?.updatedCount !== 1 ||
		rows[0]?.nextOffset !== nextOffset
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Operation account-reference progress changed concurrently'
		);
	}
}

export async function deleteOperationAccountReferenceProgress(
	manager: EntityManager,
	batchId: string
): Promise<void> {
	await manager.query(
		`delete from "full_history_operation_projection_progress"
		where "batch_id" = $1 and "projection" = $2`,
		[batchId, accountReferenceProjection]
	);
}
