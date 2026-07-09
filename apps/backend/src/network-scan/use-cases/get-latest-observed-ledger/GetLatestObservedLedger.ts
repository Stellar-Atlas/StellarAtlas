import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '../../domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';

export interface LatestObservedLedgerDTO {
	readonly closedAt: string;
	readonly protocolVersion: null;
	readonly sequence: string;
	readonly source: 'network_scan';
}

@injectable()
export class GetLatestObservedLedger {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository
	) {}

	async execute(): Promise<Result<LatestObservedLedgerDTO | null, Error>> {
		try {
			const scan = await this.networkScanRepository.findLatest();
			if (
				scan === undefined ||
				scan.latestLedger <= 0n ||
				scan.latestLedgerCloseTime === null
			) {
				return ok(null);
			}

			return ok({
				closedAt: scan.latestLedgerCloseTime.toISOString(),
				protocolVersion: null,
				sequence: scan.latestLedger.toString(),
				source: 'network_scan'
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}
