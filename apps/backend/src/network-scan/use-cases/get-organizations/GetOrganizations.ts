import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import 'reflect-metadata';
import { GetOrganizationsDTO } from './GetOrganizationsDTO.js';
import { GetNetwork } from '../get-network/GetNetwork.js';
import { OrganizationV1 } from 'shared';

@injectable()
export class GetOrganizations {
	constructor(
		private readonly getNetwork: GetNetwork,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(
		dto: GetOrganizationsDTO
	): Promise<Result<OrganizationV1[], Error>> {
		const networkOrError = await this.getNetwork.execute({
			at: dto.at
		});

		if (networkOrError.isErr()) {
			return err(networkOrError.error);
		}

		if (networkOrError.value === null) {
			return ok([]);
		}

		return ok(networkOrError.value.organizations);
	}
}
