export type FullHistoryCanonicalErrorReason =
	| 'canonical-row-conflict'
	| 'immutable-provenance-conflict'
	| 'invalid-proof-provenance'
	| 'watermark-gap';

export class FullHistoryCanonicalError extends Error {
	readonly name = 'FullHistoryCanonicalError';

	constructor(
		readonly reason: FullHistoryCanonicalErrorReason,
		message: string
	) {
		super(message);
	}
}
