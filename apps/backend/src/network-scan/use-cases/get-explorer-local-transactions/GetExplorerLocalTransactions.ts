import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { NetworkConfig } from '@core/config/Config.js';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import type { FullHistoryOperationQuery } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperation.js';
import { FullHistoryHash } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import {
	mapExplorerCanonicalOperations,
	type ExplorerLocalOperationsDTO
} from './ExplorerCanonicalOperation.js';
import {
	mapExplorerCanonicalCoverage,
	mapExplorerCanonicalTransaction,
	type ExplorerCanonicalCoverageDTO,
	type ExplorerCanonicalTransactionDTO
} from './ExplorerCanonicalTransaction.js';

export interface ExplorerLocalTransactionsDTO {
	readonly canonicalCoverage: ExplorerCanonicalCoverageDTO | null;
	readonly count: number;
	readonly generatedAt: string;
	readonly limit: number;
	readonly readModel: {
		readonly assetIndexReady: false;
		readonly contractIndexReady: false;
		readonly evidenceSelection: 'proof_gated_canonical_transaction_and_result';
		readonly operationIndexReady: false;
		readonly transactionIndexReady: boolean;
	};
	readonly records: readonly ExplorerCanonicalTransactionDTO[];
	readonly source: 'postgres_canonical';
	readonly truncated: boolean;
}

@injectable()
export class GetExplorerLocalTransactions {
	constructor(
		@inject(TYPES.FullHistoryCanonicalRepository)
		private readonly canonicalHistory: FullHistoryCanonicalRepository,
		@inject(NETWORK_TYPES.NetworkConfig)
		private readonly networkConfig: Pick<NetworkConfig, 'networkPassphrase'>
	) {}

	async execute(limit: number): Promise<ExplorerLocalTransactionsDTO> {
		const [recent, coverage] = await Promise.all([
			this.canonicalHistory.findRecentTransactions(
				this.networkConfig.networkPassphrase,
				limit
			),
			this.canonicalHistory.getCoverage(this.networkConfig.networkPassphrase)
		]);
		if (coverage === null && recent.records.length > 0) {
			throw new Error(
				'Canonical transactions exist without canonical coverage'
			);
		}

		const records = recent.records.map(mapExplorerCanonicalTransaction);
		return {
			canonicalCoverage:
				coverage === null ? null : mapExplorerCanonicalCoverage(coverage),
			count: records.length,
			generatedAt: new Date().toISOString(),
			limit,
			readModel: {
				assetIndexReady: false,
				contractIndexReady: false,
				evidenceSelection: 'proof_gated_canonical_transaction_and_result',
				operationIndexReady: false,
				transactionIndexReady: canonicalTransactionsReady(coverage)
			},
			records,
			source: 'postgres_canonical',
			truncated: recent.truncated
		};
	}

	async findByHash(
		transactionHash: string
	): Promise<ExplorerCanonicalTransactionDTO | null> {
		const transaction = await this.canonicalHistory.findTransaction(
			this.networkConfig.networkPassphrase,
			FullHistoryHash.fromHex(transactionHash)
		);
		return transaction === null
			? null
			: mapExplorerCanonicalTransaction(transaction);
	}

	async findOperations(
		query: FullHistoryOperationQuery
	): Promise<ExplorerLocalOperationsDTO> {
		const page = await this.canonicalHistory.findOperations(
			this.networkConfig.networkPassphrase,
			query
		);
		return mapExplorerCanonicalOperations(page, query);
	}
}

function canonicalTransactionsReady(
	coverage: Awaited<ReturnType<FullHistoryCanonicalRepository['getCoverage']>>
): boolean {
	return (
		coverage !== null &&
		coverage.transactionCount > 0 &&
		coverage.transactionCount === coverage.transactionResultCount
	);
}
