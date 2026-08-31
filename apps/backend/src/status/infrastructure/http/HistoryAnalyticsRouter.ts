import express, { Router } from 'express';
import type { DataSource } from 'typeorm';
import { StrKey } from '@stellar/stellar-sdk';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';

export interface HistoryAnalyticsRouterConfig {
	readonly dataSource: DataSource;
	readonly networkPassphrase: string;
}

interface AssetIdentity {
	readonly canonical: string;
	readonly code: string | null;
	readonly issuer: string | null;
	readonly type: 'credit_alphanum4' | 'credit_alphanum12' | 'native';
}

interface AssetHolderRow {
	readonly accountId: string | null;
	readonly assetType: number | string | null;
	readonly assetTypeString: string | null;
	readonly balance: string | null;
	readonly buyingLiabilities: string | null;
	readonly changeIndex: string | null;
	readonly closedAtUnixMillis: string | null;
	readonly completeBatchCount: number | string;
	readonly dataset: string;
	readonly deleted: boolean | null;
	readonly flags: string | null;
	readonly hasObservation: boolean;
	readonly importedRecordCount: string;
	readonly lastModifiedLedger: string | null;
	readonly ledgerSequence: string | null;
	readonly limit: string | null;
	readonly maximumImportedLedger: string | null;
	readonly minimumImportedLedger: string | null;
	readonly operationIndex: string | null;
	readonly reason: string | null;
	readonly sellingLiabilities: string | null;
	readonly totalBatchCount: number | string;
	readonly totalRecordCount: string;
	readonly transactionHash: string | null;
	readonly transactionIndex: string | null;
}

const assetCodePattern = /^[a-zA-Z0-9]{1,12}$/;
const authorizedFlag = 1n;
const authorizedToMaintainLiabilitiesFlag = 2n;
const clawbackEnabledFlag = 4n;

export class HistoryAnalyticsInputError extends Error {}

export function historyAnalyticsRouter(
	config: HistoryAnalyticsRouterConfig
): Router {
	const router = express.Router();

	router.get('/assets/:assetId/holders/:address', async (req, res) => {
		try {
			return res
				.status(200)
				.setHeader('Cache-Control', 'public, max-age=10')
				.json(
					await queryAssetHolder(
						config,
						req.params.assetId,
						req.params.address
					)
				);
		} catch (error) {
			if (error instanceof HistoryAnalyticsInputError) {
				return res.status(400).json({ error: error.message });
			}
			return res
				.status(503)
				.json({ error: 'Historical asset holder query is unavailable' });
		}
	});

	return router;
}

export async function queryAssetHolder(
	config: HistoryAnalyticsRouterConfig,
	assetId: string,
	address: string
) {
	const asset = parseAsset(assetId);
	if (asset === null || !StrKey.isValidEd25519PublicKey(address)) {
		throw new HistoryAnalyticsInputError(
			'assetId must be native or CODE:ISSUER and address must be a Stellar G account'
		);
	}
	const networkHash = hashNetworkPassphrase(
		config.networkPassphrase
	).toBuffer();
	const rows = await config.dataSource.query<AssetHolderRow[]>(
		asset.type === 'native' ? nativeHolderSql : creditHolderSql,
		asset.type === 'native'
			? [networkHash, address]
			: [networkHash, address, asset.code, asset.issuer]
	);
	const row = rows[0];
	if (row === undefined) {
		throw new Error('Asset holder query returned no coverage row');
	}
	return {
		address,
		asset,
		coverage: mapCoverage(row),
		generatedAt: new Date().toISOString(),
		holder: row.hasObservation ? mapHolder(row) : null
	};
}

export type HistoryAssetHolderResult = Awaited<
	ReturnType<typeof queryAssetHolder>
>;

function mapCoverage(row: AssetHolderRow): {
	readonly complete: boolean;
	readonly completeBatchCount: number;
	readonly dataset: string;
	readonly importedRecordCount: string;
	readonly immutableSource: 'stellar_atlas_lcm_parquet';
	readonly maximumImportedLedger: string | null;
	readonly minimumImportedLedger: string | null;
	readonly servingSource: 'postgresql_state_projection';
	readonly totalBatchCount: number;
	readonly totalRecordCount: string;
} {
	const completeBatchCount = safeCount(
		row.completeBatchCount,
		'completeBatchCount'
	);
	const totalBatchCount = safeCount(row.totalBatchCount, 'totalBatchCount');
	return {
		complete: totalBatchCount > 0 && completeBatchCount === totalBatchCount,
		completeBatchCount,
		dataset: requireString(row.dataset, 'dataset'),
		importedRecordCount: unsignedIntegerString(
			row.importedRecordCount,
			'importedRecordCount'
		),
		immutableSource: 'stellar_atlas_lcm_parquet',
		maximumImportedLedger: optionalUnsignedIntegerString(
			row.maximumImportedLedger,
			'maximumImportedLedger'
		),
		minimumImportedLedger: optionalUnsignedIntegerString(
			row.minimumImportedLedger,
			'minimumImportedLedger'
		),
		servingSource: 'postgresql_state_projection',
		totalBatchCount,
		totalRecordCount: unsignedIntegerString(
			row.totalRecordCount,
			'totalRecordCount'
		)
	};
}

function mapHolder(row: AssetHolderRow): {
	readonly accountId: string;
	readonly active: boolean;
	readonly assetType: number;
	readonly assetTypeString: string;
	readonly balance: string;
	readonly buyingLiabilities: string;
	readonly changeIndex: string;
	readonly clawbackEnabled: boolean | null;
	readonly closedAt: string;
	readonly deleted: boolean;
	readonly flags: string;
	readonly authorized: boolean | null;
	readonly authorizedToMaintainLiabilities: boolean | null;
	readonly lastModifiedLedger: string;
	readonly ledgerSequence: string;
	readonly limit: string | null;
	readonly operationIndex: string | null;
	readonly reason: string;
	readonly sellingLiabilities: string;
	readonly transactionHash: string | null;
	readonly transactionIndex: string;
} {
	const flags = BigInt(unsignedIntegerString(row.flags, 'flags'));
	const deleted = requireBoolean(row.deleted, 'deleted');
	const balance = signedIntegerString(row.balance, 'balance');
	const isNative = safeCount(row.assetType, 'assetType') === 0;
	return {
		accountId: requireString(row.accountId, 'accountId'),
		active: !deleted && BigInt(balance) !== 0n,
		assetType: safeCount(row.assetType, 'assetType'),
		assetTypeString: requireString(row.assetTypeString, 'assetTypeString'),
		authorized: isNative ? null : (flags & authorizedFlag) !== 0n,
		authorizedToMaintainLiabilities: isNative
			? null
			: (flags & authorizedToMaintainLiabilitiesFlag) !== 0n,
		balance: formatStroops(balance),
		buyingLiabilities: formatStroops(
			signedIntegerString(row.buyingLiabilities, 'buyingLiabilities')
		),
		changeIndex: unsignedIntegerString(row.changeIndex, 'changeIndex'),
		clawbackEnabled: isNative ? null : (flags & clawbackEnabledFlag) !== 0n,
		closedAt: new Date(
			Number(unsignedIntegerString(row.closedAtUnixMillis, 'closedAtUnixMillis'))
		).toISOString(),
		deleted,
		flags: flags.toString(),
		lastModifiedLedger: unsignedIntegerString(
			row.lastModifiedLedger,
			'lastModifiedLedger'
		),
		ledgerSequence: unsignedIntegerString(
			row.ledgerSequence,
			'ledgerSequence'
		),
		limit:
			row.limit === null
				? null
				: formatStroops(signedIntegerString(row.limit, 'limit')),
		operationIndex: optionalUnsignedIntegerString(
			row.operationIndex,
			'operationIndex'
		),
		reason: requireString(row.reason, 'reason'),
		sellingLiabilities: formatStroops(
			signedIntegerString(row.sellingLiabilities, 'sellingLiabilities')
		),
		transactionHash: optionalHex(row.transactionHash, 'transactionHash'),
		transactionIndex: unsignedIntegerString(
			row.transactionIndex,
			'transactionIndex'
		)
	};
}

function parseAsset(value: string): AssetIdentity | null {
	if (value === 'native') {
		return {
			canonical: 'native',
			code: null,
			issuer: null,
			type: 'native'
		};
	}
	const separator = value.indexOf(':');
	if (separator < 1 || separator !== value.lastIndexOf(':')) return null;
	const code = value.slice(0, separator);
	const issuer = value.slice(separator + 1);
	if (!assetCodePattern.test(code) || !StrKey.isValidEd25519PublicKey(issuer)) {
		return null;
	}
	return {
		canonical: code + ':' + issuer,
		code,
		issuer,
		type: code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12'
	};
}

function formatStroops(value: string): string {
	const negative = value.startsWith('-');
	const digits = negative ? value.slice(1) : value;
	const padded = digits.padStart(8, '0');
	const whole = padded.slice(0, -7);
	const fraction = padded.slice(-7);
	return (negative ? '-' : '') + whole + '.' + fraction;
}

function safeCount(value: unknown, field: string): number {
	const parsed = Number(unsignedIntegerString(value, field));
	if (!Number.isSafeInteger(parsed)) {
		throw new TypeError(field + ' is outside the safe integer range');
	}
	return parsed;
}

function unsignedIntegerString(value: unknown, field: string): string {
	const parsed = typeof value === 'number' ? String(value) : value;
	if (typeof parsed !== 'string' || !/^(0|[1-9][0-9]*)$/.test(parsed)) {
		throw new TypeError(field + ' is not an unsigned integer');
	}
	return parsed;
}

function optionalUnsignedIntegerString(
	value: unknown,
	field: string
): string | null {
	return value === null ? null : unsignedIntegerString(value, field);
}

function signedIntegerString(value: unknown, field: string): string {
	const parsed = typeof value === 'number' ? String(value) : value;
	if (typeof parsed !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(parsed)) {
		throw new TypeError(field + ' is not an integer');
	}
	return parsed === '-0' ? '0' : parsed;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(field + ' is not a non-empty string');
	}
	return value;
}

function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(field + ' is not a boolean');
	}
	return value;
}

function optionalHex(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
		throw new TypeError(field + ' is not a SHA-256 value');
	}
	return value;
}

const creditHolderSql = `
	with coverage as (
		select 'trustline-state-changes'::text as "dataset",
			count(*)::text as "totalBatchCount",
			count(*) filter (where control."status" = 'complete')::text
				as "completeBatchCount",
			coalesce(sum(dataset."record_count"), 0)::text
				as "totalRecordCount",
			coalesce(sum(control."imported_record_count") filter (
				where control."status" = 'complete'
			), 0)::text as "importedRecordCount",
			min(batch."start_ledger") filter (
				where control."status" = 'complete'
			)::text as "minimumImportedLedger",
			max(batch."end_ledger") filter (
				where control."status" = 'complete'
			)::text as "maximumImportedLedger"
		from "full_history_ledger_close_meta_dataset" dataset
		join "full_history_ledger_close_meta_batch" batch
			on batch."id" = dataset."batch_id"
			and batch."network_passphrase_hash" = dataset."network_passphrase_hash"
		left join "full_history_lcm_state_import" control
			on control."batch_id" = dataset."batch_id"
			and control."dataset" = dataset."dataset"
		where dataset."network_passphrase_hash" = $1
			and dataset."dataset" = 'trustline-state-changes'
	), observation as (
		select change."account_id" as "accountId",
			change."asset_type" as "assetType",
			change."asset_type_string" as "assetTypeString",
			change."balance"::text as "balance",
			change."limit"::text as "limit",
			change."buying_liabilities"::text as "buyingLiabilities",
			change."selling_liabilities"::text as "sellingLiabilities",
			change."flags"::text as "flags",
			change."ledger_sequence"::text as "ledgerSequence",
			change."transaction_index"::text as "transactionIndex",
			change."change_index"::text as "changeIndex",
			change."operation_index"::text as "operationIndex",
			encode(change."transaction_hash", 'hex') as "transactionHash",
			change."reason", change."deleted",
			change."last_modified_ledger"::text as "lastModifiedLedger",
			change."closed_at_unix_millis"::text as "closedAtUnixMillis"
		from "full_history_lcm_trustline_state_change" change
		join "full_history_lcm_state_import" control
			on control."batch_id" = change."batch_id"
			and control."dataset" = 'trustline-state-changes'
			and control."status" = 'complete'
		where change."account_id" = $2
			and change."asset_code" = $3
			and change."asset_issuer" = $4
		order by change."ledger_sequence" desc,
			change."transaction_index" desc, change."change_index" desc,
			change."batch_id"
		limit 1
	)
	select observation."accountId" is not null as "hasObservation",
		observation.*, coverage.*
	from coverage
	left join observation on true
`;

const nativeHolderSql = `
	with coverage as (
		select 'account-state-changes'::text as "dataset",
			count(*)::text as "totalBatchCount",
			count(*) filter (where control."status" = 'complete')::text
				as "completeBatchCount",
			coalesce(sum(dataset."record_count"), 0)::text
				as "totalRecordCount",
			coalesce(sum(control."imported_record_count") filter (
				where control."status" = 'complete'
			), 0)::text as "importedRecordCount",
			min(batch."start_ledger") filter (
				where control."status" = 'complete'
			)::text as "minimumImportedLedger",
			max(batch."end_ledger") filter (
				where control."status" = 'complete'
			)::text as "maximumImportedLedger"
		from "full_history_ledger_close_meta_dataset" dataset
		join "full_history_ledger_close_meta_batch" batch
			on batch."id" = dataset."batch_id"
			and batch."network_passphrase_hash" = dataset."network_passphrase_hash"
		left join "full_history_lcm_state_import" control
			on control."batch_id" = dataset."batch_id"
			and control."dataset" = dataset."dataset"
		where dataset."network_passphrase_hash" = $1
			and dataset."dataset" = 'account-state-changes'
	), observation as (
		select change."account_id" as "accountId",
			0 as "assetType", 'native'::text as "assetTypeString",
			change."balance"::text as "balance", null::text as "limit",
			change."buying_liabilities"::text as "buyingLiabilities",
			change."selling_liabilities"::text as "sellingLiabilities",
			change."flags"::text as "flags",
			change."ledger_sequence"::text as "ledgerSequence",
			change."transaction_index"::text as "transactionIndex",
			change."change_index"::text as "changeIndex",
			change."operation_index"::text as "operationIndex",
			encode(change."transaction_hash", 'hex') as "transactionHash",
			change."reason", change."deleted",
			change."last_modified_ledger"::text as "lastModifiedLedger",
			change."closed_at_unix_millis"::text as "closedAtUnixMillis"
		from "full_history_lcm_account_state_change" change
		join "full_history_lcm_state_import" control
			on control."batch_id" = change."batch_id"
			and control."dataset" = 'account-state-changes'
			and control."status" = 'complete'
		where change."account_id" = $2
		order by change."ledger_sequence" desc,
			change."transaction_index" desc, change."change_index" desc,
			change."batch_id"
		limit 1
	)
	select observation."accountId" is not null as "hasObservation",
		observation.*, coverage.*
	from coverage
	left join observation on true
`;
