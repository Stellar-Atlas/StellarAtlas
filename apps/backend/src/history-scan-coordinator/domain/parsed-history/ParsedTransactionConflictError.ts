export type ParsedTransactionCategory = 'envelope' | 'result';

export interface ParsedTransactionIdentity {
	readonly category: ParsedTransactionCategory;
	readonly categoryHash: string;
	readonly ledgerSequence: number;
	readonly transactionIndex: number;
}

export type ParsedTransactionConflictReason =
	'duplicate-batch-identity' | 'stored-value-conflict';

export class ParsedTransactionConflictError extends Error {
	constructor(
		public readonly reason: ParsedTransactionConflictReason,
		public readonly identities: readonly ParsedTransactionIdentity[]
	) {
		super(
			`Parsed transaction ${reason}: ${identities
				.map(
					(identity) =>
						`${identity.category}:${identity.ledgerSequence}:` +
						`${identity.transactionIndex}:${identity.categoryHash}`
				)
				.join(', ')}`
		);
		this.name = 'ParsedTransactionConflictError';
	}
}
