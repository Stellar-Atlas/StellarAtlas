import { assertUuid } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { StrKey } from '@stellar/stellar-sdk';
import type {
	ExplorerLocalTrustlineAssetDTO,
	ExplorerLocalTrustlineChangeDTO,
	ExplorerLocalTrustlineChangeReason,
	ExplorerLocalTrustlineCoverageRangeDTO,
	ExplorerLocalTrustlineLatestCoverageDTO
} from './ExplorerLocalTrustlineChangeDTO.js';

export interface ExplorerLocalTrustlineChangeRawRow {
	readonly accountId: unknown;
	readonly assetCode: unknown;
	readonly assetIssuer: unknown;
	readonly assetType: unknown;
	readonly assetTypeString: unknown;
	readonly balance: unknown;
	readonly batchId: unknown;
	readonly batchProcessedAt: unknown;
	readonly buyingLiabilities: unknown;
	readonly canonicalBatchIds: unknown;
	readonly canonicalCoverageCompletedAt: unknown;
	readonly canonicalProofEvaluatedAt: unknown;
	readonly changeIndex: unknown;
	readonly changeType: unknown;
	readonly changeTypeString: unknown;
	readonly closedAtUnixMillis: unknown;
	readonly coverageFirstLedger: unknown;
	readonly coverageLastLedger: unknown;
	readonly coverageLedgerCount: unknown;
	readonly datasetImportedAt: unknown;
	readonly datasetImportedRowSetSha256: unknown;
	readonly datasetName: unknown;
	readonly datasetOutputSha256: unknown;
	readonly datasetRecordCount: unknown;
	readonly datasetSchemaVersion: unknown;
	readonly deleted: unknown;
	readonly flags: unknown;
	readonly hasObservation: unknown;
	readonly lastModifiedLedger: unknown;
	readonly latestBatchId: unknown;
	readonly latestCoverageCompletedAt: unknown;
	readonly latestFirstLedger: unknown;
	readonly latestLastLedger: unknown;
	readonly latestLedgerClosedAt: unknown;
	readonly latestLedgerCount: unknown;
	readonly latestProofEvaluatedAt: unknown;
	readonly ledgerKeySha256: unknown;
	readonly ledgerSequence: unknown;
	readonly limit: unknown;
	readonly liquidityPoolId: unknown;
	readonly liquidityPoolUseCount: unknown;
	readonly manifestSha256: unknown;
	readonly minimumProofVersion: unknown;
	readonly observationLedgerClosedAt: unknown;
	readonly operationIndex: unknown;
	readonly reason: unknown;
	readonly rowSha256: unknown;
	readonly sellingLiabilities: unknown;
	readonly sponsor: unknown;
	readonly transactionHash: unknown;
	readonly transactionIndex: unknown;
	readonly upgradeIndex: unknown;
}

export function mapExplorerLocalTrustlineLatestCoverage(
	row: ExplorerLocalTrustlineChangeRawRow
): ExplorerLocalTrustlineLatestCoverageDTO {
	return {
		evidenceSelection: 'latest_complete_canonical_lcm_batch',
		freshness: {
			canonicalCoverageCompletedAt: isoTimestamp(
				row.latestCoverageCompletedAt,
				'latest canonical coverage completion'
			),
			canonicalProofEvaluatedAt: isoTimestamp(
				row.latestProofEvaluatedAt,
				'latest canonical proof evaluation'
			),
			latestCoveredLedgerClosedAt: isoTimestamp(
				row.latestLedgerClosedAt,
				'latest covered ledger close'
			)
		},
		range: coverageRange(row, 'latest')
	};
}

export function mapExplorerLocalTrustlineChange(
	row: ExplorerLocalTrustlineChangeRawRow,
	expectedAccountId: string
): ExplorerLocalTrustlineChangeDTO {
	if (row.hasObservation !== true) {
		throw new TypeError('Trustline observation row is missing');
	}
	const accountId = text(row.accountId, 'account id', false);
	if (accountId !== expectedAccountId) {
		throw new TypeError(
			'Trustline observation account differs from the request'
		);
	}
	const deleted = booleanValue(row.deleted, 'deleted');
	const changeTypeString = text(
		row.changeTypeString,
		'change type string',
		false
	);
	if ((changeTypeString === 'LEDGER_ENTRY_REMOVED') !== deleted) {
		throw new TypeError('Trustline deletion evidence is inconsistent');
	}
	const ledgerClosedAt = isoTimestamp(
		row.observationLedgerClosedAt,
		'observation ledger close'
	);
	if (ledgerClosedAt !== unixMillisTimestamp(row.closedAtUnixMillis)) {
		throw new TypeError('Trustline observation close time is inconsistent');
	}
	const coverage = coverageRange(row, 'observation');
	const ledgerSequence = decimal(row.ledgerSequence, 'ledger sequence', false);
	if (
		BigInt(ledgerSequence) < BigInt(coverage.firstLedger) ||
		BigInt(ledgerSequence) > BigInt(coverage.lastLedger)
	) {
		throw new TypeError('Trustline observation is outside its coverage range');
	}
	const lastModifiedLedger = decimal(
		row.lastModifiedLedger,
		'last modified ledger',
		false
	);
	if (BigInt(lastModifiedLedger) > BigInt(ledgerSequence)) {
		throw new TypeError('Trustline last modified ledger is inconsistent');
	}

	return {
		change: {
			changeType: integer(row.changeType, 'change type', 0),
			changeTypeString,
			lastModifiedLedger,
			reason: changeReason(row.reason),
			sponsor: nullableText(row.sponsor, 'sponsor'),
			transactionHash: nullableHash(row.transactionHash, 'transaction hash')
		},
		coverage,
		deleted,
		freshness: {
			batchProcessedAt: isoTimestamp(row.batchProcessedAt, 'batch processing'),
			canonicalCoverageCompletedAt: isoTimestamp(
				row.canonicalCoverageCompletedAt,
				'canonical coverage completion'
			),
			canonicalProofEvaluatedAt: isoTimestamp(
				row.canonicalProofEvaluatedAt,
				'canonical proof evaluation'
			),
			datasetImportedAt: isoTimestamp(
				row.datasetImportedAt,
				'dataset import completion'
			),
			ledgerClosedAt
		},
		position: {
			changeIndex: decimal(row.changeIndex, 'change index', false),
			ledgerSequence,
			operationIndex: nullableDecimal(
				row.operationIndex,
				'operation index',
				false
			),
			transactionIndex: decimal(
				row.transactionIndex,
				'transaction index',
				false
			),
			upgradeIndex: nullableDecimal(row.upgradeIndex, 'upgrade index', false)
		},
		provenance: {
			batch: { id: uuid(row.batchId, 'batch id') },
			dataset: {
				importedRowSetSha256: hash(
					row.datasetImportedRowSetSha256,
					'dataset imported row set'
				),
				name: datasetName(row.datasetName),
				outputSha256: hash(row.datasetOutputSha256, 'dataset output'),
				recordCount: decimal(
					row.datasetRecordCount,
					'dataset record count',
					false
				),
				schemaVersion: text(
					row.datasetSchemaVersion,
					'dataset schema version',
					false
				)
			},
			manifest: { sha256: hash(row.manifestSha256, 'processing manifest') },
			proof: {
				canonicalBatchIds: uuidArray(
					row.canonicalBatchIds,
					'canonical proof batch ids'
				),
				minimumVersion: integer(
					row.minimumProofVersion,
					'minimum proof version',
					6
				)
			},
			row: {
				ledgerKeySha256: hash(row.ledgerKeySha256, 'ledger key'),
				sha256: hash(row.rowSha256, 'row')
			}
		},
		stateSemantics: deleted
			? 'final_pre_deletion_state'
			: 'observed_post_change_state',
		trustlineFields: {
			accountId,
			asset: assetIdentity(row),
			balance: decimal(row.balance, 'balance', true),
			buyingLiabilities: decimal(
				row.buyingLiabilities,
				'buying liabilities',
				false
			),
			flags: decimal(row.flags, 'flags', false),
			limit: decimal(row.limit, 'trustline limit', false),
			liquidityPoolUseCount: decimal(
				row.liquidityPoolUseCount,
				'liquidity pool use count',
				false
			),
			sellingLiabilities: decimal(
				row.sellingLiabilities,
				'selling liabilities',
				false
			)
		}
	};
}

function assetIdentity(
	row: ExplorerLocalTrustlineChangeRawRow
): ExplorerLocalTrustlineAssetDTO {
	const assetType = integer(row.assetType, 'asset type', 1, 3);
	const assetTypeString = canonicalAssetTypeString(row.assetTypeString);
	const code = nullableText(row.assetCode, 'asset code');
	const issuer = nullableText(row.assetIssuer, 'asset issuer');
	const liquidityPoolId = nullableHash(
		row.liquidityPoolId,
		'liquidity pool id'
	);
	if (assetType === 1 && assetTypeString === 'ASSET_TYPE_CREDIT_ALPHANUM4') {
		return creditAsset(1, code, issuer, liquidityPoolId);
	}
	if (assetType === 2 && assetTypeString === 'ASSET_TYPE_CREDIT_ALPHANUM12') {
		return creditAsset(2, code, issuer, liquidityPoolId);
	}
	if (
		assetType === 3 &&
		assetTypeString === 'ASSET_TYPE_POOL_SHARE' &&
		code === null &&
		issuer === null &&
		liquidityPoolId !== null
	) {
		return {
			assetType: 3,
			assetTypeString,
			code: null,
			issuer: null,
			kind: 'liquidity_pool_share',
			liquidityPoolId
		};
	}
	throw new TypeError('Trustline asset identity is invalid');
}

type CanonicalAssetTypeString =
	ExplorerLocalTrustlineAssetDTO['assetTypeString'];

function canonicalAssetTypeString(value: unknown): CanonicalAssetTypeString {
	switch (text(value, 'asset type string', false)) {
		case 'ASSET_TYPE_CREDIT_ALPHANUM4':
		case 'AssetTypeAssetTypeCreditAlphanum4':
			return 'ASSET_TYPE_CREDIT_ALPHANUM4';
		case 'ASSET_TYPE_CREDIT_ALPHANUM12':
		case 'AssetTypeAssetTypeCreditAlphanum12':
			return 'ASSET_TYPE_CREDIT_ALPHANUM12';
		case 'ASSET_TYPE_POOL_SHARE':
		case 'AssetTypeAssetTypePoolShare':
			return 'ASSET_TYPE_POOL_SHARE';
		default:
			throw new TypeError('Trustline asset type string is invalid');
	}
}

function creditAsset(
	assetType: 1 | 2,
	code: string | null,
	issuer: string | null,
	liquidityPoolId: string | null
): ExplorerLocalTrustlineAssetDTO {
	const maximumCodeBytes = assetType === 1 ? 4 : 12;
	if (
		code === null ||
		Buffer.byteLength(code, 'utf8') > maximumCodeBytes ||
		issuer === null ||
		!StrKey.isValidEd25519PublicKey(issuer) ||
		liquidityPoolId !== null
	) {
		throw new TypeError('Trustline credit asset identity is invalid');
	}
	return assetType === 1
		? {
				assetType,
				assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM4',
				code,
				issuer,
				kind: 'credit_alphanum4',
				liquidityPoolId: null
			}
		: {
				assetType,
				assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM12',
				code,
				issuer,
				kind: 'credit_alphanum12',
				liquidityPoolId: null
			};
}

function coverageRange(
	row: ExplorerLocalTrustlineChangeRawRow,
	kind: 'latest' | 'observation'
): ExplorerLocalTrustlineCoverageRangeDTO {
	const latest = kind === 'latest';
	const firstLedger = decimal(
		latest ? row.latestFirstLedger : row.coverageFirstLedger,
		`${kind} first ledger`,
		false
	);
	const lastLedger = decimal(
		latest ? row.latestLastLedger : row.coverageLastLedger,
		`${kind} last ledger`,
		false
	);
	const ledgerCount = integer(
		latest ? row.latestLedgerCount : row.coverageLedgerCount,
		`${kind} ledger count`,
		1,
		1024
	);
	if (
		BigInt(firstLedger) < 1n ||
		BigInt(lastLedger) - BigInt(firstLedger) + 1n !== BigInt(ledgerCount)
	) {
		throw new TypeError(`${kind} coverage range is inconsistent`);
	}
	return {
		batchId: uuid(latest ? row.latestBatchId : row.batchId, `${kind} batch id`),
		firstLedger,
		lastLedger,
		ledgerCount
	};
}

function changeReason(value: unknown): ExplorerLocalTrustlineChangeReason {
	if (
		value === 'fee' ||
		value === 'fee_refund' ||
		value === 'operation' ||
		value === 'transaction' ||
		value === 'upgrade'
	) {
		return value;
	}
	throw new TypeError('Trustline change reason is invalid');
}

function datasetName(value: unknown): 'trustline-state-changes' {
	if (value !== 'trustline-state-changes') {
		throw new TypeError('Trustline observation dataset is invalid');
	}
	return value;
}

function text(value: unknown, label: string, allowEmpty: boolean): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

function nullableText(value: unknown, label: string): string | null {
	return value === null ? null : text(value, label, false);
}

function decimal(value: unknown, label: string, signed: boolean): string {
	if (
		(typeof value !== 'string' && typeof value !== 'number') ||
		!(signed ? /^-?(0|[1-9]\d*)$/u : /^(0|[1-9]\d*)$/u).test(
			value.toString()
		) ||
		(typeof value === 'number' && !Number.isSafeInteger(value))
	) {
		throw new TypeError(`${label} is invalid`);
	}
	return BigInt(value).toString();
}

function nullableDecimal(
	value: unknown,
	label: string,
	signed: boolean
): string | null {
	return value === null ? null : decimal(value, label, signed);
}

function integer(
	value: unknown,
	label: string,
	minimum: number,
	maximum = Number.MAX_SAFE_INTEGER
): number {
	if (typeof value === 'string' && !/^(0|[1-9]\d*)$/u.test(value)) {
		throw new TypeError(`${label} is invalid`);
	}
	const parsed = Number(value);
	if (
		(typeof value !== 'number' && typeof value !== 'string') ||
		!Number.isSafeInteger(parsed) ||
		parsed < minimum ||
		parsed > maximum
	) {
		throw new TypeError(`${label} is invalid`);
	}
	return parsed;
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${label} is invalid`);
	return value;
}

function hash(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
		throw new TypeError(`${label} sha256 is invalid`);
	}
	return value;
}

function nullableHash(value: unknown, label: string): string | null {
	return value === null ? null : hash(value, label);
}

function uuid(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} is invalid`);
	}
	try {
		return assertUuid(value, label);
	} catch {
		throw new TypeError(`${label} is invalid`);
	}
}

function uuidArray(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new TypeError(`${label} is invalid`);
	}
	return value.map((entry) => uuid(entry, label));
}

function isoTimestamp(value: unknown, label: string): string {
	if (typeof value !== 'string' && !(value instanceof Date)) {
		throw new TypeError(`${label} timestamp is invalid`);
	}
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.valueOf())) {
		throw new TypeError(`${label} timestamp is invalid`);
	}
	return date.toISOString();
}

function unixMillisTimestamp(value: unknown): string {
	const milliseconds = BigInt(decimal(value, 'closed at unix millis', false));
	if (milliseconds > 8_640_000_000_000_000n) {
		throw new TypeError('closed at unix millis is invalid');
	}
	return new Date(Number(milliseconds)).toISOString();
}
