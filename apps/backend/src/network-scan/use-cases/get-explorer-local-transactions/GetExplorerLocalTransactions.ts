import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { ParsedTransactionResultRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedTransactionResultRepository.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';

export interface ExplorerLocalTransactionDTO {
	readonly joins: {
		readonly envelopeAvailable: boolean;
		readonly ledgerHeaderAvailable: boolean;
	};
	readonly ledger: string;
	readonly ledgerHeaderHash: string | null;
	readonly localEvidence: {
		readonly envelopeObservedAt: string | null;
		readonly envelopeSourceArchiveUrl: string | null;
		readonly ledgerHeaderObservedAt: string | null;
		readonly ledgerHeaderSourceArchiveUrl: string | null;
		readonly resultObservedAt: string;
		readonly resultSourceArchiveUrl: string;
	};
	readonly protocolVersion: number | null;
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string | null;
}

export interface ExplorerLocalTransactionsDTO {
	readonly count: number;
	readonly generatedAt: string;
	readonly limit: number;
	readonly readModel: {
		readonly assetIndexReady: false;
		readonly contractIndexReady: false;
		readonly envelopeJoinReady: boolean;
		readonly evidenceSelection: 'parsed_transaction_result_joined_to_parsed_ledger_header_and_envelope';
		readonly ledgerHeaderJoinReady: boolean;
		readonly operationIndexReady: false;
		readonly parsedTransactionResultsReady: boolean;
	};
	readonly records: readonly ExplorerLocalTransactionDTO[];
	readonly source: 'parsed_history_postgres';
}

@injectable()
export class GetExplorerLocalTransactions {
	constructor(
		@inject(TYPES.ParsedTransactionResultRepository)
		private readonly parsedTransactions: ParsedTransactionResultRepository
	) {}

	async execute(limit: number): Promise<ExplorerLocalTransactionsDTO> {
		const rows =
			await this.parsedTransactions.findRecentWithLedgerContext(limit);
		const records = rows.map((row) => ({
			joins: {
				envelopeAvailable: row.envelopeObservedAt !== null,
				ledgerHeaderAvailable: row.headerObservedAt !== null
			},
			ledger: row.ledgerSequence.toString(),
			ledgerHeaderHash: row.ledgerHeaderHash,
			localEvidence: {
				envelopeObservedAt: toIsoOrNull(row.envelopeObservedAt),
				envelopeSourceArchiveUrl: row.envelopeSourceArchiveUrl,
				ledgerHeaderObservedAt: toIsoOrNull(row.headerObservedAt),
				ledgerHeaderSourceArchiveUrl: row.headerSourceArchiveUrl,
				resultObservedAt: row.resultObservedAt.toISOString(),
				resultSourceArchiveUrl: row.resultSourceArchiveUrl
			},
			protocolVersion: row.protocolVersion,
			transactionHash: row.transactionHash,
			transactionIndex: row.transactionIndex,
			transactionResultHash: row.transactionResultHash,
			transactionSetHash: row.transactionSetHash
		}));

		return {
			count: records.length,
			generatedAt: new Date().toISOString(),
			limit,
			readModel: {
				assetIndexReady: false,
				contractIndexReady: false,
				envelopeJoinReady: records.some(
					(record) => record.joins.envelopeAvailable
				),
				evidenceSelection:
					'parsed_transaction_result_joined_to_parsed_ledger_header_and_envelope',
				ledgerHeaderJoinReady: records.some(
					(record) => record.joins.ledgerHeaderAvailable
				),
				operationIndexReady: false,
				parsedTransactionResultsReady: records.length > 0
			},
			records,
			source: 'parsed_history_postgres'
		};
	}
}

function toIsoOrNull(value: Date | null): string | null {
	return value === null ? null : value.toISOString();
}
