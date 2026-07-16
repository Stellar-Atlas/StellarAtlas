import type {
	PublicExplorerLocalAccountChange,
	PublicExplorerLocalAccountChanges,
	PublicExplorerLocalAccountCoverageRange,
	PublicExplorerLocalAccountFields,
	PublicExplorerLocalAccountLatestCoverage,
	PublicExplorerLocalAccountSigner
} from './explorer-local-account-types';
import {
	arrayOf,
	boolean,
	dateTime,
	isRecord,
	literal,
	lowercaseSha256,
	matches,
	nonEmptyString,
	nonNegativeInteger,
	nullable,
	oneOf,
	unsignedIntegerString,
	uuid
} from './status-live-validator-primitives';

const accountId = (value: unknown): value is string =>
	typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value);
const nullableAccountId = nullable(accountId);
const nullableUnsignedIntegerString = nullable(unsignedIntegerString);
const nullableSha256 = nullable(lowercaseSha256);
const byte = (value: unknown): value is number =>
	Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 255;

const signerValidator = matches({
	key: nonEmptyString,
	sponsor: nullableAccountId,
	weight: byte
});

const accountFieldsValidator = matches({
	accountId,
	balance: unsignedIntegerString,
	buyingLiabilities: unsignedIntegerString,
	flags: unsignedIntegerString,
	highThreshold: byte,
	homeDomain: (value) => typeof value === 'string',
	inflationDestination: nullableAccountId,
	lowThreshold: byte,
	masterWeight: byte,
	mediumThreshold: byte,
	sequenceLedger: nullableUnsignedIntegerString,
	sequenceNumber: unsignedIntegerString,
	sequenceTime: nullableUnsignedIntegerString,
	signers: arrayOf(signerValidator, 256),
	sellingLiabilities: unsignedIntegerString,
	sponsoredEntryCount: unsignedIntegerString,
	sponsoringEntryCount: unsignedIntegerString,
	subentryCount: unsignedIntegerString
});

const coverageRangeValidator = matches({
	batchId: uuid,
	firstLedger: unsignedIntegerString,
	lastLedger: unsignedIntegerString,
	ledgerCount: nonNegativeInteger
});

const latestCoverageValidator = matches({
	evidenceSelection: literal('latest_complete_canonical_lcm_batch'),
	freshness: matches({
		canonicalCoverageCompletedAt: dateTime,
		canonicalProofEvaluatedAt: dateTime,
		latestCoveredLedgerClosedAt: dateTime
	}),
	range: coverageRangeValidator
});

const changeValidator = matches({
	accountFields: accountFieldsValidator,
	change: matches({
		changeType: nonNegativeInteger,
		changeTypeString: nonEmptyString,
		lastModifiedLedger: unsignedIntegerString,
		reason: oneOf('fee', 'fee_refund', 'operation', 'transaction', 'upgrade'),
		sponsor: nullableAccountId,
		transactionHash: nullableSha256
	}),
	coverage: coverageRangeValidator,
	deleted: boolean,
	freshness: matches({
		batchProcessedAt: dateTime,
		canonicalCoverageCompletedAt: dateTime,
		canonicalProofEvaluatedAt: dateTime,
		datasetImportedAt: dateTime,
		ledgerClosedAt: dateTime
	}),
	position: matches({
		changeIndex: unsignedIntegerString,
		ledgerSequence: unsignedIntegerString,
		operationIndex: nullableUnsignedIntegerString,
		transactionIndex: unsignedIntegerString,
		upgradeIndex: nullableUnsignedIntegerString
	}),
	provenance: matches({
		batch: matches({ id: uuid }),
		dataset: matches({
			importedRowSetSha256: lowercaseSha256,
			name: literal('account-state-changes'),
			outputSha256: lowercaseSha256,
			recordCount: unsignedIntegerString,
			schemaVersion: nonEmptyString
		}),
		manifest: matches({ sha256: lowercaseSha256 }),
		proof: matches({
			canonicalBatchIds: arrayOf(uuid, 256),
			minimumVersion: nonNegativeInteger
		}),
		row: matches({
			ledgerKeySha256: lowercaseSha256,
			sha256: lowercaseSha256
		})
	}),
	stateSemantics: oneOf(
		'observed_post_change_state',
		'final_pre_deletion_state'
	)
});

const responseValidator = matches(
	{
		accountId,
		count: nonNegativeInteger,
		coverage: nullable(latestCoverageValidator),
		generatedAt: dateTime,
		interpretation: literal('historical_observations_not_current_state'),
		limit: nonNegativeInteger,
		records: arrayOf(changeValidator, 100),
		source: literal('postgres_proof_gated_lcm_account_changes'),
		status: oneOf('available', 'not_observed', 'unavailable'),
		truncated: boolean
	},
	{
		reason: oneOf(
			'no_change_observed_in_complete_coverage',
			'complete_canonical_coverage_empty'
		)
	}
);

export function parseExplorerLocalAccountChanges(
	value: unknown
): PublicExplorerLocalAccountChanges | null {
	if (!responseValidator(value) || !isRecord(value)) return null;
	const coverage = parseLatestCoverage(value.coverage);
	const records = parseChanges(value.records);
	if (records === null || !isCoherentResponse(value, coverage, records)) {
		return null;
	}
	const base = {
		accountId: value.accountId as string,
		count: value.count as number,
		generatedAt: value.generatedAt as string,
		interpretation: 'historical_observations_not_current_state' as const,
		limit: value.limit as number,
		records,
		source: 'postgres_proof_gated_lcm_account_changes' as const,
		truncated: value.truncated as boolean
	};
	if (value.status === 'available' && coverage !== null) {
		return { ...base, coverage, status: 'available' };
	}
	if (value.status === 'not_observed' && coverage !== null) {
		return {
			...base,
			coverage,
			reason: 'no_change_observed_in_complete_coverage',
			status: 'not_observed'
		};
	}
	if (value.status === 'unavailable' && coverage === null) {
		return {
			...base,
			coverage: null,
			reason: 'complete_canonical_coverage_empty',
			status: 'unavailable'
		};
	}
	return null;
}

function parseChanges(
	value: unknown
): readonly PublicExplorerLocalAccountChange[] | null {
	if (!Array.isArray(value)) return null;
	const parsed = value.map(parseChange);
	return parsed.every((record) => record !== null)
		? (parsed as readonly PublicExplorerLocalAccountChange[])
		: null;
}

function parseChange(value: unknown): PublicExplorerLocalAccountChange | null {
	if (!changeValidator(value) || !isRecord(value)) return null;
	const fields = parseAccountFields(value.accountFields);
	const coverage = parseCoverageRange(value.coverage);
	if (
		fields === null ||
		coverage === null ||
		!isRecord(value.change) ||
		!isRecord(value.freshness) ||
		!isRecord(value.position) ||
		!isRecord(value.provenance) ||
		!isRecord(value.provenance.batch) ||
		!isRecord(value.provenance.dataset) ||
		!isRecord(value.provenance.manifest) ||
		!isRecord(value.provenance.proof) ||
		!isRecord(value.provenance.row)
	)
		return null;
	const semantics = value.stateSemantics;
	if ((value.deleted === true) !== (semantics === 'final_pre_deletion_state'))
		return null;
	return {
		accountFields: fields,
		change: {
			changeType: value.change.changeType as number,
			changeTypeString: value.change.changeTypeString as string,
			lastModifiedLedger: value.change.lastModifiedLedger as string,
			reason: value.change
				.reason as PublicExplorerLocalAccountChange['change']['reason'],
			sponsor: value.change.sponsor as string | null,
			transactionHash: value.change.transactionHash as string | null
		},
		coverage,
		deleted: value.deleted as boolean,
		freshness: {
			batchProcessedAt: value.freshness.batchProcessedAt as string,
			canonicalCoverageCompletedAt: value.freshness
				.canonicalCoverageCompletedAt as string,
			canonicalProofEvaluatedAt: value.freshness
				.canonicalProofEvaluatedAt as string,
			datasetImportedAt: value.freshness.datasetImportedAt as string,
			ledgerClosedAt: value.freshness.ledgerClosedAt as string
		},
		position: {
			changeIndex: value.position.changeIndex as string,
			ledgerSequence: value.position.ledgerSequence as string,
			operationIndex: value.position.operationIndex as string | null,
			transactionIndex: value.position.transactionIndex as string,
			upgradeIndex: value.position.upgradeIndex as string | null
		},
		provenance: {
			batch: { id: value.provenance.batch.id as string },
			dataset: {
				importedRowSetSha256: value.provenance.dataset
					.importedRowSetSha256 as string,
				name: 'account-state-changes',
				outputSha256: value.provenance.dataset.outputSha256 as string,
				recordCount: value.provenance.dataset.recordCount as string,
				schemaVersion: value.provenance.dataset.schemaVersion as string
			},
			manifest: { sha256: value.provenance.manifest.sha256 as string },
			proof: {
				canonicalBatchIds: [
					...(value.provenance.proof.canonicalBatchIds as readonly string[])
				],
				minimumVersion: value.provenance.proof.minimumVersion as number
			},
			row: {
				ledgerKeySha256: value.provenance.row.ledgerKeySha256 as string,
				sha256: value.provenance.row.sha256 as string
			}
		},
		stateSemantics:
			semantics as PublicExplorerLocalAccountChange['stateSemantics']
	};
}

function parseAccountFields(
	value: unknown
): PublicExplorerLocalAccountFields | null {
	if (!accountFieldsValidator(value) || !isRecord(value)) return null;
	return {
		accountId: value.accountId as string,
		balance: value.balance as string,
		buyingLiabilities: value.buyingLiabilities as string,
		flags: value.flags as string,
		highThreshold: value.highThreshold as number,
		homeDomain: value.homeDomain as string,
		inflationDestination: value.inflationDestination as string | null,
		lowThreshold: value.lowThreshold as number,
		masterWeight: value.masterWeight as number,
		mediumThreshold: value.mediumThreshold as number,
		sequenceLedger: value.sequenceLedger as string | null,
		sequenceNumber: value.sequenceNumber as string,
		sequenceTime: value.sequenceTime as string | null,
		signers: (value.signers as readonly unknown[]).map(parseSigner),
		sellingLiabilities: value.sellingLiabilities as string,
		sponsoredEntryCount: value.sponsoredEntryCount as string,
		sponsoringEntryCount: value.sponsoringEntryCount as string,
		subentryCount: value.subentryCount as string
	};
}

function parseSigner(value: unknown): PublicExplorerLocalAccountSigner {
	if (!signerValidator(value) || !isRecord(value)) {
		throw new TypeError('Validated signer became invalid');
	}
	return {
		key: value.key as string,
		sponsor: value.sponsor as string | null,
		weight: value.weight as number
	};
}

function parseLatestCoverage(
	value: unknown
): PublicExplorerLocalAccountLatestCoverage | null {
	if (
		!latestCoverageValidator(value) ||
		!isRecord(value) ||
		!isRecord(value.freshness)
	)
		return null;
	const range = parseCoverageRange(value.range);
	return range === null
		? null
		: {
				evidenceSelection: 'latest_complete_canonical_lcm_batch',
				freshness: {
					canonicalCoverageCompletedAt: value.freshness
						.canonicalCoverageCompletedAt as string,
					canonicalProofEvaluatedAt: value.freshness
						.canonicalProofEvaluatedAt as string,
					latestCoveredLedgerClosedAt: value.freshness
						.latestCoveredLedgerClosedAt as string
				},
				range
			};
}

function parseCoverageRange(
	value: unknown
): PublicExplorerLocalAccountCoverageRange | null {
	if (!coverageRangeValidator(value) || !isRecord(value)) return null;
	const firstLedger = value.firstLedger as string;
	const lastLedger = value.lastLedger as string;
	const ledgerCount = value.ledgerCount as number;
	if (BigInt(lastLedger) - BigInt(firstLedger) + 1n !== BigInt(ledgerCount))
		return null;
	return {
		batchId: value.batchId as string,
		firstLedger,
		lastLedger,
		ledgerCount
	};
}

function isCoherentResponse(
	value: Record<string, unknown>,
	coverage: PublicExplorerLocalAccountLatestCoverage | null,
	records: readonly PublicExplorerLocalAccountChange[]
): boolean {
	const count = value.count as number;
	const limit = value.limit as number;
	if (limit < 1 || count < records.length || records.length > limit)
		return false;
	if (
		records.some((record) => record.accountFields.accountId !== value.accountId)
	)
		return false;
	if (value.status === 'available')
		return coverage !== null && records.length > 0;
	if (value.status === 'not_observed') {
		return (
			coverage !== null &&
			count === 0 &&
			records.length === 0 &&
			value.reason === 'no_change_observed_in_complete_coverage'
		);
	}
	return (
		value.status === 'unavailable' &&
		coverage === null &&
		count === 0 &&
		records.length === 0 &&
		value.reason === 'complete_canonical_coverage_empty'
	);
}
