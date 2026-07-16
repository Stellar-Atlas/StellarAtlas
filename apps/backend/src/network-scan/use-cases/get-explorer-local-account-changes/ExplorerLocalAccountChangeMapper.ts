import type {
	ExplorerLocalAccountChangeDTO,
	ExplorerLocalAccountChangeReason,
	ExplorerLocalAccountCoverageRangeDTO,
	ExplorerLocalAccountLatestCoverageDTO
} from './ExplorerLocalAccountChangeDTO.js';

export interface ExplorerLocalAccountChangeRawRow {
	readonly accountId: unknown;
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
	readonly highThreshold: unknown;
	readonly homeDomain: unknown;
	readonly inflationDestination: unknown;
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
	readonly lowThreshold: unknown;
	readonly manifestSha256: unknown;
	readonly masterWeight: unknown;
	readonly mediumThreshold: unknown;
	readonly minimumProofVersion: unknown;
	readonly observationLedgerClosedAt: unknown;
	readonly operationIndex: unknown;
	readonly reason: unknown;
	readonly rowSha256: unknown;
	readonly sellingLiabilities: unknown;
	readonly sequenceLedger: unknown;
	readonly sequenceNumber: unknown;
	readonly sequenceTime: unknown;
	readonly signerCount: unknown;
	readonly signerKeys: unknown;
	readonly signerSponsors: unknown;
	readonly signerWeights: unknown;
	readonly sponsor: unknown;
	readonly sponsoredEntryCount: unknown;
	readonly sponsoringEntryCount: unknown;
	readonly subentryCount: unknown;
	readonly transactionHash: unknown;
	readonly transactionIndex: unknown;
	readonly upgradeIndex: unknown;
}

export function mapExplorerLocalAccountLatestCoverage(
	row: ExplorerLocalAccountChangeRawRow
): ExplorerLocalAccountLatestCoverageDTO {
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

export function mapExplorerLocalAccountChange(
	row: ExplorerLocalAccountChangeRawRow,
	expectedAccountId: string
): ExplorerLocalAccountChangeDTO {
	if (row.hasObservation !== true) {
		throw new TypeError('Account observation row is missing');
	}
	const accountId = text(row.accountId, 'account id', false);
	if (accountId !== expectedAccountId) {
		throw new TypeError('Account observation id differs from the request');
	}
	const signerCount = safeCount(row.signerCount, 'signer count');
	const signerKeys = stringArray(row.signerKeys, 'signer keys', false);
	const signerWeights = integerArray(
		row.signerWeights,
		'signer weights',
		0,
		255
	);
	const signerSponsors = nullableStringArray(
		row.signerSponsors,
		'signer sponsors'
	);
	if (
		signerKeys.length !== signerCount ||
		signerWeights.length !== signerCount ||
		signerSponsors.length !== signerCount
	) {
		throw new TypeError('Account signer arrays do not match signer count');
	}
	const ledgerClosedAt = isoTimestamp(
		row.observationLedgerClosedAt,
		'observation ledger close'
	);
	if (ledgerClosedAt !== unixMillisTimestamp(row.closedAtUnixMillis)) {
		throw new TypeError('Account observation close time is inconsistent');
	}
	const deleted = booleanValue(row.deleted, 'deleted');
	return {
		accountFields: {
			accountId,
			balance: decimal(row.balance, 'balance', true),
			buyingLiabilities: decimal(
				row.buyingLiabilities,
				'buying liabilities',
				false
			),
			flags: decimal(row.flags, 'flags', false),
			highThreshold: integer(row.highThreshold, 'high threshold', 0, 255),
			homeDomain: text(row.homeDomain, 'home domain', true),
			inflationDestination: nullableText(
				row.inflationDestination,
				'inflation destination'
			),
			lowThreshold: integer(row.lowThreshold, 'low threshold', 0, 255),
			masterWeight: integer(row.masterWeight, 'master weight', 0, 255),
			mediumThreshold: integer(row.mediumThreshold, 'medium threshold', 0, 255),
			sequenceLedger: nullableDecimal(
				row.sequenceLedger,
				'sequence ledger',
				false
			),
			sequenceNumber: decimal(row.sequenceNumber, 'sequence number', false),
			sequenceTime: nullableDecimal(row.sequenceTime, 'sequence time', false),
			signers: signerKeys.map((key, index) => ({
				key,
				sponsor: signerSponsors[index] ?? null,
				weight: signerWeights[index] ?? invalidSignerWeight()
			})),
			sellingLiabilities: decimal(
				row.sellingLiabilities,
				'selling liabilities',
				false
			),
			sponsoredEntryCount: decimal(
				row.sponsoredEntryCount,
				'sponsored entry count',
				false
			),
			sponsoringEntryCount: decimal(
				row.sponsoringEntryCount,
				'sponsoring entry count',
				false
			),
			subentryCount: decimal(row.subentryCount, 'subentry count', false)
		},
		change: {
			changeType: integer(row.changeType, 'change type', 0),
			changeTypeString: text(row.changeTypeString, 'change type string', false),
			lastModifiedLedger: decimal(
				row.lastModifiedLedger,
				'last modified ledger',
				false
			),
			reason: changeReason(row.reason),
			sponsor: nullableText(row.sponsor, 'sponsor'),
			transactionHash: nullableHash(row.transactionHash, 'transaction hash')
		},
		coverage: coverageRange(row, 'observation'),
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
			ledgerSequence: decimal(row.ledgerSequence, 'ledger sequence', false),
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
			: 'observed_post_change_state'
	};
}

function coverageRange(
	row: ExplorerLocalAccountChangeRawRow,
	kind: 'latest' | 'observation'
): ExplorerLocalAccountCoverageRangeDTO {
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

function changeReason(value: unknown): ExplorerLocalAccountChangeReason {
	if (
		value === 'fee' ||
		value === 'fee_refund' ||
		value === 'operation' ||
		value === 'transaction' ||
		value === 'upgrade'
	) {
		return value;
	}
	throw new TypeError('Account change reason is invalid');
}

function datasetName(value: unknown): 'account-state-changes' {
	if (value !== 'account-state-changes') {
		throw new TypeError('Account observation dataset is invalid');
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

function safeCount(value: unknown, label: string): number {
	const parsed = BigInt(decimal(value, label, false));
	if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new TypeError(`${label} is invalid`);
	}
	return Number(parsed);
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
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value
		)
	) {
		throw new TypeError(`${label} is invalid`);
	}
	return value.toLowerCase();
}

function uuidArray(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new TypeError(`${label} is invalid`);
	}
	return value.map((entry) => uuid(entry, label));
}

function stringArray(
	value: unknown,
	label: string,
	allowEmpty: boolean
): readonly string[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} is invalid`);
	return value.map((entry) => text(entry, label, allowEmpty));
}

function integerArray(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number
): readonly number[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} is invalid`);
	return value.map((entry) => integer(entry, label, minimum, maximum));
}

function nullableStringArray(
	value: unknown,
	label: string
): readonly (string | null)[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} is invalid`);
	return value.map((entry) => nullableText(entry, label));
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

function invalidSignerWeight(): never {
	throw new TypeError('Account signer weight is missing');
}
