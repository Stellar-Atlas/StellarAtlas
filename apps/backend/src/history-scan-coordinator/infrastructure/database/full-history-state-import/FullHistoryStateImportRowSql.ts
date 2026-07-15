import type {
	FullHistoryAccountStateChange,
	FullHistoryStateChange,
	FullHistoryTrustlineStateChange
} from '../../../domain/full-history-state-import/FullHistoryStateExport.js';
import type { FullHistoryStateRowEvidence } from '../../../domain/full-history-state-import/FullHistoryStateRowEvidence.js';

export interface FullHistoryStateInsertQuery {
	readonly parameters: readonly unknown[];
	readonly sql: string;
}

const accountColumns = [
	'batch_id',
	'row_sha256',
	'ledger_sequence',
	'transaction_index',
	'change_index',
	'transaction_hash',
	'reason',
	'operation_index',
	'upgrade_index',
	'change_type',
	'change_type_string',
	'deleted',
	'ledger_key_sha256',
	'state_entry_xdr',
	'last_modified_ledger',
	'sponsor',
	'closed_at_unix_millis',
	'account_id',
	'balance',
	'buying_liabilities',
	'selling_liabilities',
	'sequence_number',
	'sequence_ledger',
	'sequence_time',
	'subentry_count',
	'flags',
	'home_domain',
	'inflation_destination',
	'master_weight',
	'low_threshold',
	'medium_threshold',
	'high_threshold',
	'sponsored_entry_count',
	'sponsoring_entry_count',
	'signer_count',
	'signer_keys',
	'signer_weights',
	'signer_sponsors'
] as const;

const trustlineColumns = [
	'batch_id',
	'row_sha256',
	'ledger_sequence',
	'transaction_index',
	'change_index',
	'transaction_hash',
	'reason',
	'operation_index',
	'upgrade_index',
	'change_type',
	'change_type_string',
	'deleted',
	'ledger_key_sha256',
	'state_entry_xdr',
	'last_modified_ledger',
	'sponsor',
	'closed_at_unix_millis',
	'account_id',
	'asset_type',
	'asset_type_string',
	'asset_code',
	'asset_issuer',
	'liquidity_pool_id',
	'balance',
	'limit',
	'buying_liabilities',
	'selling_liabilities',
	'liquidity_pool_use_count',
	'flags'
] as const;

export function accountStateInsertQuery(
	batchId: string,
	rows: readonly FullHistoryStateRowEvidence<FullHistoryAccountStateChange>[]
): FullHistoryStateInsertQuery {
	return buildInsert(
		'full_history_lcm_account_state_change',
		accountColumns,
		rows.map((row) => accountValues(batchId, row)),
		new Set([35, 36, 37])
	);
}

export function trustlineStateInsertQuery(
	batchId: string,
	rows: readonly FullHistoryStateRowEvidence<FullHistoryTrustlineStateChange>[]
): FullHistoryStateInsertQuery {
	return buildInsert(
		'full_history_lcm_trustline_state_change',
		trustlineColumns,
		rows.map((row) => trustlineValues(batchId, row)),
		new Set()
	);
}

function accountValues(
	batchId: string,
	evidence: FullHistoryStateRowEvidence<FullHistoryAccountStateChange>
): readonly unknown[] {
	const row = evidence.row;
	return [
		batchId,
		Buffer.from(evidence.rowSha256, 'hex'),
		row.ledgerSequence,
		row.transactionIndex,
		row.changeIndex,
		hexOrNull(row.transactionHash),
		row.reason,
		row.operationIndex,
		row.upgradeIndex,
		row.changeType,
		row.changeTypeString,
		row.deleted,
		Buffer.from(row.ledgerKeySha256, 'hex'),
		Buffer.from(row.stateEntryXdrBase64, 'base64'),
		row.lastModifiedLedger,
		row.sponsor,
		row.closedAtUnixMillis,
		row.accountId,
		row.balance,
		row.buyingLiabilities,
		row.sellingLiabilities,
		row.sequenceNumber,
		row.sequenceLedger,
		row.sequenceTime,
		row.subentryCount,
		row.flags,
		row.homeDomain,
		row.inflationDestination,
		row.masterWeight,
		row.lowThreshold,
		row.mediumThreshold,
		row.highThreshold,
		row.sponsoredEntryCount,
		row.sponsoringEntryCount,
		row.signerCount,
		JSON.stringify(row.signerKeys),
		JSON.stringify(row.signerWeights),
		JSON.stringify(row.signerSponsors)
	];
}

function trustlineValues(
	batchId: string,
	evidence: FullHistoryStateRowEvidence<FullHistoryTrustlineStateChange>
): readonly unknown[] {
	const row = evidence.row;
	return [
		batchId,
		Buffer.from(evidence.rowSha256, 'hex'),
		row.ledgerSequence,
		row.transactionIndex,
		row.changeIndex,
		hexOrNull(row.transactionHash),
		row.reason,
		row.operationIndex,
		row.upgradeIndex,
		row.changeType,
		row.changeTypeString,
		row.deleted,
		Buffer.from(row.ledgerKeySha256, 'hex'),
		Buffer.from(row.stateEntryXdrBase64, 'base64'),
		row.lastModifiedLedger,
		row.sponsor,
		row.closedAtUnixMillis,
		row.accountId,
		row.assetType,
		row.assetTypeString,
		nullIfEmpty(row.assetCode),
		nullIfEmpty(row.assetIssuer),
		row.liquidityPoolId.length === 0
			? null
			: Buffer.from(row.liquidityPoolId, 'hex'),
		row.balance,
		row.limit,
		row.buyingLiabilities,
		row.sellingLiabilities,
		row.liquidityPoolUseCount,
		row.flags
	];
}

export function stateRowDigestVerificationQuery(
	table:
		| 'full_history_lcm_account_state_change'
		| 'full_history_lcm_trustline_state_change',
	batchId: string,
	rows: readonly FullHistoryStateRowEvidence[]
): FullHistoryStateInsertQuery {
	if (rows.length === 0 || rows.length > 500) {
		throw new TypeError(
			'State digest verification batch must contain 1 to 500 rows'
		);
	}
	const parameters: unknown[] = [batchId];
	const values = rows.map(({ row, rowSha256 }) => {
		const valuesWithCasts = [
			[row.ledgerSequence, 'bigint'],
			[row.transactionIndex, 'bigint'],
			[row.changeIndex, 'bigint'],
			[Buffer.from(rowSha256, 'hex'), 'bytea']
		] as const;
		const placeholders = valuesWithCasts.map(([value, cast]) => {
			parameters.push(value);
			return `$${parameters.length}::${cast}`;
		});
		return `(${placeholders.join(', ')})`;
	});
	return {
		parameters,
		sql: `with expected (ledger_sequence, transaction_index, change_index, row_sha256) as (
			values ${values.join(', ')}
		)
		select count(*)::text as "count"
		from expected
			join "${table}" actual
				on actual."batch_id" = $1
				and actual."ledger_sequence" = expected.ledger_sequence
				and actual."transaction_index" = expected.transaction_index
				and actual."change_index" = expected.change_index
				and actual."row_sha256" = expected.row_sha256`
	};
}

function buildInsert(
	table: string,
	columns: readonly string[],
	rows: readonly (readonly unknown[])[],
	jsonColumnIndexes: ReadonlySet<number>
): FullHistoryStateInsertQuery {
	if (rows.length === 0 || rows.length > 500) {
		throw new TypeError('State import insert batch must contain 1 to 500 rows');
	}
	const parameters: unknown[] = [];
	const tuples = rows.map((row) => {
		if (row.length !== columns.length) {
			throw new TypeError('State import row does not match its SQL columns');
		}
		const placeholders = row.map((value, columnIndex) => {
			parameters.push(value);
			const cast = jsonColumnIndexes.has(columnIndex) ? '::jsonb' : '';
			return `$${parameters.length}${cast}`;
		});
		return `(${placeholders.join(', ')})`;
	});
	return {
		parameters,
		sql: `insert into "${table}" (${columns.map((name) => `"${name}"`).join(', ')}) values ${tuples.join(', ')} on conflict do nothing`
	};
}

function hexOrNull(value: string): Buffer | null {
	return value.length === 0 ? null : Buffer.from(value, 'hex');
}

function nullIfEmpty(value: string): string | null {
	return value.length === 0 ? null : value;
}
