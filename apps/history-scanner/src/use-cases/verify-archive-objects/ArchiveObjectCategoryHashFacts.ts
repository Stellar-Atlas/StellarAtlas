import type { HistoryArchiveObjectVerificationFactsV1 } from 'shared';
import type { CategoryVerificationData } from '../../domain/scanner/CategoryScanner.js';

/** Stable ledger ordering for the existing category verification facts. */
export function mapHashFacts(
	hashes: ReadonlyMap<number, string>
): readonly { readonly hash: string; readonly ledger: number }[] {
	return Array.from(hashes.entries())
		.map(([ledger, hash]) => ({ hash, ledger }))
		.sort((left, right) => left.ledger - right.ledger);
}

export function createCategoryVerificationFacts(
	objectType: string,
	data: CategoryVerificationData,
	entryCount: number,
	sourceUrl: string
): HistoryArchiveObjectVerificationFactsV1 {
	if (objectType === 'ledger') {
		return {
			ledgerCategory: {
				entryCount,
				headerHashesVerified: true,
				ledgers: Array.from(data.expectedHashesPerLedger.entries())
					.map(([ledger, expectedHashes]) => ({
						bucketListHash: expectedHashes.bucketListHash,
						ledger,
						ledgerHeaderHash:
							data.calculatedLedgerHeaderHashes.get(ledger) ?? null,
						previousLedgerHeaderHash: expectedHashes.previousLedgerHeaderHash,
						protocolVersion: data.protocolVersions.get(ledger) ?? null,
						transactionResultSetHash: expectedHashes.txSetResultHash,
						transactionSetHash: expectedHashes.txSetHash
					}))
					.sort((left, right) => left.ledger - right.ledger),
				sourceUrl
			}
		};
	}
	if (objectType === 'transactions') {
		return {
			transactionsCategory: {
				entryCount,
				ledgers: mapHashFacts(data.calculatedTxSetHashes),
				sourceUrl
			}
		};
	}
	if (objectType === 'results') {
		return {
			resultsCategory: {
				entryCount,
				ledgers: mapHashFacts(data.calculatedTxSetResultHashes),
				sourceUrl
			}
		};
	}
	return { scpCategory: { entryCount, sourceUrl } };
}
