import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import 'reflect-metadata';
import { GetNodeDTO } from './GetNodeDTO.js';
import { GetNetwork } from '../get-network/GetNetwork.js';
import { NodeV1 } from 'shared';

@injectable()
export class GetNode {
	constructor(
		private readonly getNetwork: GetNetwork,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(dto: GetNodeDTO): Promise<Result<NodeV1 | null, Error>> {
		const networkOrError = await this.getNetwork.execute({
			at: dto.at
		});

		if (networkOrError.isErr()) {
			return err(networkOrError.error);
		}

		if (networkOrError.value === null) {
			return ok(null);
		}

		const node = networkOrError.value.nodes.find(
			(node) => node.publicKey === dto.publicKey
		);

		if (!node) return ok(null);

		return ok(node);
	}
}
