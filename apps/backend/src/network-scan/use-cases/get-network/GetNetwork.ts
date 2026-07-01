import { Network, NetworkV1 } from 'shared';
import { inject, injectable } from 'inversify';
import { Result } from 'neverthrow';
import { GetNetworkDTO } from './GetNetworkDTO.js';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import 'reflect-metadata';
import { NetworkDTOService } from '../../services/NetworkDTOService.js';
import { CachedNetworkDTOService } from '../../services/CachedNetworkDTOService.js';

@injectable()
export class GetNetwork {
	constructor(
		private readonly networkDTOService: CachedNetworkDTOService,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger
	) {}

	async execute(dto: GetNetworkDTO): Promise<Result<NetworkV1 | null, Error>> {
		let networkOrError: Result<NetworkV1 | null, Error>;
		if (dto.at === undefined)
			networkOrError = await this.networkDTOService.getLatestNetworkDTO();
		else networkOrError = await this.networkDTOService.getNetworkDTOAt(dto.at);

		if (networkOrError.isErr()) {
			this.exceptionLogger.captureException(networkOrError.error);
		}

		return networkOrError;
	}
}
