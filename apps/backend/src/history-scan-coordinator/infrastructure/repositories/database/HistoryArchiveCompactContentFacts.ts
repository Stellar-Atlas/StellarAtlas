import type { PreparedContentCompletion } from './HistoryArchiveContentReuseWrite.js';
import type { HistoryArchiveObjectVerificationFacts } from '../../../domain/history-archive-object/HistoryArchiveObject.js';

// Persistence-only representation. Worker/public DTOs still require full arrays;
// only the server's already claim-bound immutable artifact can authorize this.
export interface HistoryArchiveCompactContentFacts {
	readonly content: NonNullable<
		HistoryArchiveObjectVerificationFacts['content']
	>;
	readonly contentReference: {
		readonly artifactId: string;
		readonly claimAttempt: number;
		readonly contentRepresentation: 'uncompressed-xdr';
		readonly derivationVersion: 1;
		readonly sourceObjectRemoteId: string;
	};
	readonly [category: string]: unknown;
}

export function contentFactsForStorage(
	prepared: PreparedContentCompletion,
	enabled = process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED === 'true'
):
	| HistoryArchiveObjectVerificationFacts
	| HistoryArchiveCompactContentFacts
	| null
	| undefined {
	const facts = prepared.progress.verificationFacts;
	const reuse = prepared.reuse;
	if (!enabled || reuse === null || facts?.content === undefined) return facts;
	const categoryKey =
		facts.ledgerCategory !== undefined
			? 'ledgerCategory'
			: facts.transactionsCategory !== undefined
				? 'transactionsCategory'
				: facts.resultsCategory !== undefined
					? 'resultsCategory'
					: null;
	if (categoryKey === null) return facts; // SCP has no per-ledger arrays to deduplicate.
	const category = facts[categoryKey]!;
	const { ledgers, ...scalars } = category;
	const sequences = [...new Set(ledgers.map((fact) => fact.ledger))].toSorted(
		(left, right) => left - right
	);
	const compact: HistoryArchiveCompactContentFacts = {
		content: facts.content,
		contentReference: {
			artifactId: reuse.artifactId,
			claimAttempt: prepared.progress.claimAttempt,
			contentRepresentation: reuse.contentRepresentation,
			derivationVersion: reuse.derivationVersion,
			sourceObjectRemoteId: reuse.sourceObjectRemoteId
		},
		[categoryKey]: {
			...scalars,
			sharedSummary: {
				firstLedger: sequences[0] ?? null,
				lastLedger: sequences.at(-1) ?? null,
				ledgerCount: sequences.length
			}
		}
	};
	// References add overhead for small categories. Persist them only when they
	// actually reduce the serialized UTF-8 payload; existing references still read.
	return Buffer.byteLength(JSON.stringify(compact), 'utf8') <
		Buffer.byteLength(JSON.stringify(facts), 'utf8')
		? compact
		: facts;
}
