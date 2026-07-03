import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetNodes } from '@network-scan/use-cases/get-nodes/GetNodes.js';
import type { CrossCheckValidatorsDTO } from '../../domain/CrossCheckValidator.js';
import {
	isValidatorLikeNode,
	mapCrossCheckValidators
} from '../network-rows/CrossCheckNetworkRowsMapper.js';

export interface GetCrossCheckValidatorsDTO {
	readonly limit?: number;
}

@injectable()
export class GetCrossCheckValidators {
	private static readonly defaultLimit = 50;
	static readonly maxLimit = 100;

	constructor(@inject(GetNodes) private readonly getNodes: GetNodes) {}

	async execute(
		dto: GetCrossCheckValidatorsDTO = {}
	): Promise<Result<CrossCheckValidatorsDTO, Error>> {
		const nodesOrError = await this.getNodes.execute({});
		if (nodesOrError.isErr()) return err(nodesOrError.error);

		const validators = nodesOrError.value.filter(isValidatorLikeNode);
		const limit = this.normalizeLimit(dto.limit);

		return ok(
			mapCrossCheckValidators({
				generatedAt: new Date().toISOString(),
				limit,
				nodes: validators
			})
		);
	}

	private normalizeLimit(limit: number | undefined): number {
		if (limit === undefined) return GetCrossCheckValidators.defaultLimit;

		return Math.min(limit, GetCrossCheckValidators.maxLimit);
	}
}
