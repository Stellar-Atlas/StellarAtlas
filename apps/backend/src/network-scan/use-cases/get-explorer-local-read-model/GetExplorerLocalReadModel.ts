import { inject, injectable } from 'inversify';
import type { ParsedLedgerHeaderRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';

export interface ExplorerLocalReadModelDTO {
	readonly generatedAt: string;
	readonly indexes: {
		readonly assetIndexReady: false;
		readonly contractIndexReady: false;
		readonly operationIndexReady: false;
		readonly transactionIndexReady: false;
	};
	readonly parsedLedgerHeaders: {
		readonly earliestParsedLedger: string | null;
		readonly latestObservedAt: string | null;
		readonly latestParsedLedger: string | null;
		readonly latestParsedLedgerHash: string | null;
		readonly parsedLedgerCount: number;
		readonly sourceArchiveCount: number;
	};
	readonly source: 'parsed_ledger_header_repository';
	readonly transactions: {
		readonly localCoverage: false;
		readonly message: string;
		readonly source: 'horizon_fallback';
	};
}

@injectable()
export class GetExplorerLocalReadModel {
	constructor(
		@inject(TYPES.ParsedLedgerHeaderRepository)
		private readonly parsedLedgerHeaders: ParsedLedgerHeaderRepository
	) {}

	async execute(): Promise<ExplorerLocalReadModelDTO> {
		const watermark = await this.parsedLedgerHeaders.getWatermark();

		return {
			generatedAt: new Date().toISOString(),
			indexes: {
				assetIndexReady: false,
				contractIndexReady: false,
				operationIndexReady: false,
				transactionIndexReady: false
			},
			parsedLedgerHeaders: {
				earliestParsedLedger: toNullableString(
					watermark.earliestLedgerSequence
				),
				latestObservedAt: watermark.latestObservedAt?.toISOString() ?? null,
				latestParsedLedger: toNullableString(watermark.latestLedgerSequence),
				latestParsedLedgerHash: watermark.latestLedgerHeaderHash,
				parsedLedgerCount: watermark.parsedLedgerCount,
				sourceArchiveCount: watermark.sourceArchiveCount
			},
			source: 'parsed_ledger_header_repository',
			transactions: {
				localCoverage: false,
				message:
					'Transactions remain Horizon fallback; no StellarAtlas local transaction index is available yet.',
				source: 'horizon_fallback'
			}
		};
	}
}

function toNullableString(value: number | null): string | null {
	return value === null ? null : value.toString();
}
