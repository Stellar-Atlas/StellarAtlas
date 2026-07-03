import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetOrganizations } from '@network-scan/use-cases/get-organizations/GetOrganizations.js';
import type { CrossCheckOrganizationsDTO } from '../../domain/CrossCheckOrganization.js';
import { mapCrossCheckOrganizations } from '../network-rows/CrossCheckNetworkRowsMapper.js';

export interface GetCrossCheckOrganizationsDTO {
	readonly limit?: number;
}

@injectable()
export class GetCrossCheckOrganizations {
	private static readonly defaultLimit = 50;
	static readonly maxLimit = 100;

	constructor(
		@inject(GetOrganizations)
		private readonly getOrganizations: GetOrganizations
	) {}

	async execute(
		dto: GetCrossCheckOrganizationsDTO = {}
	): Promise<Result<CrossCheckOrganizationsDTO, Error>> {
		const organizationsOrError = await this.getOrganizations.execute({});
		if (organizationsOrError.isErr()) return err(organizationsOrError.error);

		const limit = this.normalizeLimit(dto.limit);

		return ok(
			mapCrossCheckOrganizations({
				generatedAt: new Date().toISOString(),
				limit,
				organizations: organizationsOrError.value
			})
		);
	}

	private normalizeLimit(limit: number | undefined): number {
		if (limit === undefined) return GetCrossCheckOrganizations.defaultLimit;

		return Math.min(limit, GetCrossCheckOrganizations.maxLimit);
	}
}
