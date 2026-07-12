import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '../../domain/network/scan/NetworkScanRepository.js';
import type {
	ScpLatestObservedLedger,
	ScpStatementObservationRepository,
	ScpStatementWriter
} from '../../domain/scp/ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';

export interface LatestObservedLedgerDTO {
	readonly closedAt: string;
	readonly freshness: 'fresh';
	readonly freshnessMs: number;
	readonly observedAt: string;
	readonly protocolVersion: null;
	readonly sequence: string;
	readonly source: ScpStatementWriter;
}

@injectable()
export class GetLatestObservedLedger {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject(NETWORK_TYPES.ScpStatementObservationRepository)
		private readonly scpStatementObservationRepository: ScpStatementObservationRepository
	) {}

	async execute(): Promise<Result<LatestObservedLedgerDTO | null, Error>> {
		try {
			const nowMs = Date.now();
			let scpFailure: Error | null = null;
			try {
				const ledger =
					await this.scpStatementObservationRepository.findLatestObservedLedger();
				if (ledger !== null) {
					const candidate = toFreshLedgerDTO(ledger, nowMs);
					if (candidate !== null) return ok(candidate);
				}
			} catch (error) {
				scpFailure = mapUnknownToError(error);
			}

			try {
				const scan = await this.networkScanRepository.findLatest();
				if (
					scan === undefined ||
					scan.latestLedger <= 0n ||
					scan.latestLedgerCloseTime === null
				) {
					return scpFailure === null ? ok(null) : err(scpFailure);
				}
				const candidate = toFreshLedgerDTO(
					{
						closedAt: scan.latestLedgerCloseTime,
						observedAt: scan.time,
						sequence: scan.latestLedger.toString(),
						source: 'network_scan'
					},
					nowMs
				);
				return candidate !== null || scpFailure === null
					? ok(candidate)
					: err(scpFailure);
			} catch (error) {
				return err(mapUnknownToError(error));
			}
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

function toFreshLedgerDTO(
	ledger: ScpLatestObservedLedger,
	nowMs: number
): LatestObservedLedgerDTO | null {
	const freshnessMs = nowMs - ledger.closedAt.getTime();
	if (
		freshnessMs > scpStatementObservationPolicy.readFreshnessMs ||
		freshnessMs < -scpStatementObservationPolicy.readFutureToleranceMs
	) {
		return null;
	}
	return {
		closedAt: ledger.closedAt.toISOString(),
		freshness: 'fresh',
		freshnessMs: Math.max(0, freshnessMs),
		observedAt: ledger.observedAt.toISOString(),
		protocolVersion: null,
		sequence: ledger.sequence,
		source: ledger.source
	};
}
