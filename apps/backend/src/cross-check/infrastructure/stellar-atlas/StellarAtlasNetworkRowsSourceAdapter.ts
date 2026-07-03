import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import type { CrossCheckStellarAtlasNetworkRowsSource } from '../../domain/CrossCheckRadarNetworkSnapshot.js';
import type { CrossCheckStellarAtlasNetworkRowsDTO } from '../../domain/CrossCheckRadarNetworkComparison.js';
import { mapCrossCheckNetworkRows } from '../../use-cases/network-rows/CrossCheckNetworkRowsMapper.js';

@injectable()
export class StellarAtlasNetworkRowsSourceAdapter implements CrossCheckStellarAtlasNetworkRowsSource {
	constructor(
		@inject(GetNetwork) private readonly getNetwork: GetNetwork,
		private readonly now: () => Date = () => new Date()
	) {}

	async readRows(): Promise<
		Result<CrossCheckStellarAtlasNetworkRowsDTO, Error>
	> {
		const networkOrError = await this.getNetwork.execute({});
		if (networkOrError.isErr()) return err(networkOrError.error);
		if (networkOrError.value === null) {
			return err(
				new Error('No latest StellarAtlas network snapshot available')
			);
		}

		return ok(
			mapCrossCheckNetworkRows({
				generatedAt: this.now().toISOString(),
				organizations: networkOrError.value.organizations,
				validators: networkOrError.value.nodes
			})
		);
	}
}
