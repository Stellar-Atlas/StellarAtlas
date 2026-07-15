import { createHash } from 'node:crypto';
import {
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryAccountStateChange,
	FullHistoryStateChange,
	FullHistoryTrustlineStateChange
} from './FullHistoryStateExport.js';

export interface FullHistoryStateRowEvidence<
	Row extends FullHistoryStateChange = FullHistoryStateChange
> {
	readonly row: Row;
	readonly rowSha256: FullHistoryLedgerCloseMetaSha256Digest;
}

export class FullHistoryStateRowSetHasher {
	private readonly hash = createHash('sha256');
	private previous: FullHistoryStatePosition | null = null;

	append<Row extends FullHistoryStateChange>(
		row: Row
	): FullHistoryStateRowEvidence<Row> {
		const position = positionOf(row);
		if (
			this.previous !== null &&
			comparePosition(this.previous, position) >= 0
		) {
			throw new Error(
				'State exporter rows are not in strict primary-key order'
			);
		}
		this.previous = position;
		const rowSha256 = fullHistoryStateRowSha256(row);
		this.hash.update(Buffer.from(rowSha256, 'hex'));
		return Object.freeze({ row, rowSha256 });
	}

	finish(): FullHistoryLedgerCloseMetaSha256Digest {
		return fullHistoryLedgerCloseMetaSha256Digest(this.hash.digest('hex'));
	}
}

export function fullHistoryStateRowSha256(
	row: FullHistoryStateChange
): FullHistoryLedgerCloseMetaSha256Digest {
	const encoded = JSON.stringify(
		isAccountStateChange(row)
			? accountCanonicalValues(row)
			: trustlineCanonicalValues(row)
	);
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(encoded, 'utf8').digest('hex')
	);
}

interface FullHistoryStatePosition {
	readonly changeIndex: bigint;
	readonly ledgerSequence: bigint;
	readonly transactionIndex: bigint;
}

function positionOf(row: FullHistoryStateChange): FullHistoryStatePosition {
	return {
		changeIndex: BigInt(row.changeIndex),
		ledgerSequence: BigInt(row.ledgerSequence),
		transactionIndex: BigInt(row.transactionIndex)
	};
}

function comparePosition(
	left: FullHistoryStatePosition,
	right: FullHistoryStatePosition
): number {
	for (const key of [
		'ledgerSequence',
		'transactionIndex',
		'changeIndex'
	] as const) {
		if (left[key] < right[key]) return -1;
		if (left[key] > right[key]) return 1;
	}
	return 0;
}

function commonCanonicalValues(
	row: FullHistoryStateChange
): readonly unknown[] {
	return [
		row.ledgerSequence,
		row.transactionIndex,
		row.changeIndex,
		row.transactionHash,
		row.reason,
		row.operationIndex,
		row.upgradeIndex,
		row.changeType,
		row.changeTypeString,
		row.deleted,
		row.ledgerKeySha256,
		row.stateEntryXdrBase64,
		row.lastModifiedLedger,
		row.sponsor,
		row.closedAtUnixMillis
	];
}

function accountCanonicalValues(
	row: FullHistoryAccountStateChange
): readonly unknown[] {
	return [
		'account-state-changes',
		...commonCanonicalValues(row),
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
		row.signerKeys,
		row.signerWeights,
		row.signerSponsors
	];
}

function trustlineCanonicalValues(
	row: FullHistoryTrustlineStateChange
): readonly unknown[] {
	return [
		'trustline-state-changes',
		...commonCanonicalValues(row),
		row.accountId,
		row.assetType,
		row.assetTypeString,
		row.assetCode,
		row.assetIssuer,
		row.liquidityPoolId,
		row.balance,
		row.limit,
		row.buyingLiabilities,
		row.sellingLiabilities,
		row.liquidityPoolUseCount,
		row.flags
	];
}

function isAccountStateChange(
	row: FullHistoryStateChange
): row is FullHistoryAccountStateChange {
	return 'signerCount' in row;
}
