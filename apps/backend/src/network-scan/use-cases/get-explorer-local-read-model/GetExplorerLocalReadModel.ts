import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { NetworkConfig } from '@core/config/Config.js';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import type { ParsedLedgerHeaderRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import {
	mapExplorerCanonicalCoverage,
	type ExplorerCanonicalCoverageDTO
} from '../get-explorer-local-transactions/ExplorerCanonicalTransaction.js';

export interface ExplorerLocalReadModelDTO {
	readonly generatedAt: string;
	readonly indexes: {
		readonly assetIndexReady: false;
		readonly contractIndexReady: false;
		readonly operationIndexReady: false;
		readonly transactionIndexReady: boolean;
	};
	readonly parsedLedgerHeaders: {
		readonly earliestParsedLedger: string | null;
		readonly latestObservedAt: string | null;
		readonly latestParsedLedger: string | null;
		readonly latestParsedLedgerHash: string | null;
		readonly parsedLedgerCount: number;
		readonly sourceArchiveCount: number;
	};
	readonly source:
		| 'full_history_canonical_repository'
		| 'parsed_ledger_header_repository';
	readonly transactions: {
		readonly canonicalCoverage: ExplorerCanonicalCoverageDTO | null;
		readonly localCoverage: boolean;
		readonly message: string;
		readonly source: 'horizon_fallback' | 'postgres_canonical';
	};
}

@injectable()
export class GetExplorerLocalReadModel {
	constructor(
		@inject(TYPES.ParsedLedgerHeaderRepository)
		private readonly parsedLedgerHeaders: ParsedLedgerHeaderRepository,
		@inject(TYPES.FullHistoryCanonicalRepository)
		private readonly canonicalHistory: FullHistoryCanonicalRepository,
		@inject(NETWORK_TYPES.NetworkConfig)
		private readonly networkConfig: Pick<NetworkConfig, 'networkPassphrase'>
	) {}

	async execute(): Promise<ExplorerLocalReadModelDTO> {
		const coverage = await this.canonicalHistory.getCoverage(
			this.networkConfig.networkPassphrase
		);
		const watermark =
			coverage === null
				? await this.parsedLedgerHeaders.getWatermark()
				: emptyParsedLedgerWatermark;
		const transactionIndexReady =
			coverage !== null &&
			coverage.transactionCount > 0 &&
			coverage.transactionCount === coverage.transactionResultCount;

		return {
			generatedAt: new Date().toISOString(),
			indexes: {
				assetIndexReady: false,
				contractIndexReady: false,
				operationIndexReady: false,
				transactionIndexReady
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
			source:
				coverage === null
					? 'parsed_ledger_header_repository'
					: 'full_history_canonical_repository',
			transactions:
				coverage === null
					? {
							canonicalCoverage: null,
							localCoverage: false,
							message:
								'No bounded canonical transaction coverage is available; transaction reads use Horizon fallback.',
							source: 'horizon_fallback'
						}
					: {
							canonicalCoverage: mapExplorerCanonicalCoverage(coverage),
							localCoverage: true,
							message:
								'Transactions are available from the bounded proof-gated canonical range.',
							source: 'postgres_canonical'
						}
		};
	}
}

const emptyParsedLedgerWatermark = {
	earliestLedgerSequence: null,
	latestLedgerHeaderHash: null,
	latestLedgerSequence: null,
	latestObservedAt: null,
	parsedLedgerCount: 0,
	sourceArchiveCount: 0
} as const;

function toNullableString(value: number | null): string | null {
	return value === null ? null : value.toString();
}
