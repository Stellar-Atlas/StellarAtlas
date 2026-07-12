export interface ParsedLedgerHeaderIdentity {
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: number;
}

export type ParsedLedgerHeaderConflictReason =
	'duplicate-batch-identity' | 'stored-value-conflict';

export class ParsedLedgerHeaderConflictError extends Error {
	constructor(
		public readonly reason: ParsedLedgerHeaderConflictReason,
		public readonly identities: readonly ParsedLedgerHeaderIdentity[]
	) {
		super(
			`Parsed ledger header ${reason} for ${identities
				.map(
					(identity) =>
						`${identity.ledgerSequence}:${identity.ledgerHeaderHash}`
				)
				.join(', ')}`
		);
		this.name = 'ParsedLedgerHeaderConflictError';
	}
}
