import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { NetworkConfig } from '@core/config/Config.js';
import type {
	FullHistoryCanonicalCoverageView,
	FullHistoryCanonicalRepository
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import {
	validateFullHistoryLedgerRangeQuery,
	type FullHistoryCanonicalLedgerView,
	type FullHistoryLedgerRangeQuery
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalLedger.js';
import type { FullHistoryLedgerSequence } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import {
	mapCanonicalCoverage,
	type CanonicalFullHistoryCoverageDTO
} from '@history-scan-coordinator/use-cases/get-full-history-canonical-coverage/FullHistoryCanonicalCoverageDTO.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import {
	mapExplorerCanonicalLedgerDetail,
	type ExplorerCanonicalLedgerDetailDTO
} from './ExplorerCanonicalLedgerDetail.js';

export interface ExplorerLedgerRequestedRangeDTO {
	readonly firstLedger: string;
	readonly lastLedger: string;
}

interface ExplorerLocalLedgerResultBase {
	readonly generatedAt: string;
	readonly requestedRange: ExplorerLedgerRequestedRangeDTO;
	readonly source: 'postgres_canonical';
}

export interface ExplorerLocalLedgerUnavailableDTO extends ExplorerLocalLedgerResultBase {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO | null;
	readonly reason: 'canonical_coverage_empty' | 'outside_canonical_coverage';
	readonly status: 'unavailable';
}

export interface ExplorerLocalLedgerNotFoundDTO extends ExplorerLocalLedgerResultBase {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO;
	readonly reason: 'ledger_absent_within_canonical_coverage';
	readonly status: 'not_found';
}

export interface ExplorerLocalLedgerLookupAvailableDTO extends ExplorerLocalLedgerResultBase {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO;
	readonly ledger: ExplorerCanonicalLedgerDetailDTO;
	readonly status: 'available';
}

export interface ExplorerLocalLedgerRangeAvailableDTO extends ExplorerLocalLedgerResultBase {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO;
	readonly count: number;
	readonly records: readonly ExplorerCanonicalLedgerDetailDTO[];
	readonly status: 'available';
}

export type ExplorerLocalLedgerLookupDTO =
	| ExplorerLocalLedgerLookupAvailableDTO
	| ExplorerLocalLedgerNotFoundDTO
	| ExplorerLocalLedgerUnavailableDTO;

export type ExplorerLocalLedgerRangeDTO =
	ExplorerLocalLedgerRangeAvailableDTO | ExplorerLocalLedgerUnavailableDTO;

interface CoveredLedgerRange {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO;
	readonly generatedAt: string;
	readonly records: readonly FullHistoryCanonicalLedgerView[];
	readonly requestedRange: ExplorerLedgerRequestedRangeDTO;
	readonly status: 'covered';
}

@injectable()
export class GetExplorerLocalLedgers {
	constructor(
		@inject(TYPES.FullHistoryCanonicalRepository)
		private readonly canonicalHistory: FullHistoryCanonicalRepository,
		@inject(NETWORK_TYPES.NetworkConfig)
		private readonly networkConfig: Pick<NetworkConfig, 'networkPassphrase'>
	) {}

	async findBySequence(
		ledgerSequence: FullHistoryLedgerSequence
	): Promise<ExplorerLocalLedgerLookupDTO> {
		const result = await this.readRange({
			firstLedger: ledgerSequence,
			lastLedger: ledgerSequence
		});
		if (result.status === 'unavailable') return result;
		const ledger = result.records[0];
		if (ledger === undefined) {
			return {
				canonicalCoverage: result.canonicalCoverage,
				generatedAt: result.generatedAt,
				reason: 'ledger_absent_within_canonical_coverage',
				requestedRange: result.requestedRange,
				source: 'postgres_canonical',
				status: 'not_found'
			};
		}
		if (result.records.length !== 1) throw canonicalCoverageGapError();
		return {
			canonicalCoverage: result.canonicalCoverage,
			generatedAt: result.generatedAt,
			ledger: mapExplorerCanonicalLedgerDetail(ledger),
			requestedRange: result.requestedRange,
			source: 'postgres_canonical',
			status: 'available'
		};
	}

	async findRange(
		query: FullHistoryLedgerRangeQuery
	): Promise<ExplorerLocalLedgerRangeDTO> {
		const result = await this.readRange(query);
		if (result.status === 'unavailable') return result;
		const expectedCount =
			Number(BigInt(query.lastLedger) - BigInt(query.firstLedger)) + 1;
		if (result.records.length !== expectedCount) {
			throw canonicalCoverageGapError();
		}
		return {
			canonicalCoverage: result.canonicalCoverage,
			count: result.records.length,
			generatedAt: result.generatedAt,
			records: result.records.map(mapExplorerCanonicalLedgerDetail),
			requestedRange: result.requestedRange,
			source: 'postgres_canonical',
			status: 'available'
		};
	}

	private async readRange(
		query: FullHistoryLedgerRangeQuery
	): Promise<CoveredLedgerRange | ExplorerLocalLedgerUnavailableDTO> {
		validateFullHistoryLedgerRangeQuery(query);
		const generatedAt = new Date().toISOString();
		const requestedRange = mapRequestedRange(query);
		const coverage = await this.canonicalHistory.getCoverage(
			this.networkConfig.networkPassphrase
		);
		if (coverage === null) {
			return {
				canonicalCoverage: null,
				generatedAt,
				reason: 'canonical_coverage_empty',
				requestedRange,
				source: 'postgres_canonical',
				status: 'unavailable'
			};
		}
		const canonicalCoverage = mapCanonicalCoverage(coverage);
		if (!isCovered(query, coverage)) {
			return {
				canonicalCoverage,
				generatedAt,
				reason: 'outside_canonical_coverage',
				requestedRange,
				source: 'postgres_canonical',
				status: 'unavailable'
			};
		}
		const page = await this.canonicalHistory.findLedgerRange(
			this.networkConfig.networkPassphrase,
			query
		);
		return {
			canonicalCoverage,
			generatedAt,
			records: page.records,
			requestedRange,
			status: 'covered'
		};
	}
}

function mapRequestedRange(
	query: FullHistoryLedgerRangeQuery
): ExplorerLedgerRequestedRangeDTO {
	return {
		firstLedger: query.firstLedger,
		lastLedger: query.lastLedger
	};
}

function isCovered(
	query: FullHistoryLedgerRangeQuery,
	coverage: FullHistoryCanonicalCoverageView
): boolean {
	return (
		BigInt(query.firstLedger) >= BigInt(coverage.firstLedger) &&
		BigInt(query.lastLedger) <= BigInt(coverage.lastLedger)
	);
}

function canonicalCoverageGapError(): Error {
	return new Error('Canonical ledger coverage contains a row gap');
}
