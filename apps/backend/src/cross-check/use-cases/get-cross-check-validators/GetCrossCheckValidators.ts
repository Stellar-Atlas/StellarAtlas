import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { NodeV1 } from 'shared';
import { GetNodes } from '@network-scan/use-cases/get-nodes/GetNodes.js';
import type {
	CrossCheckValidatorDTO,
	CrossCheckValidatorEvidenceStatus,
	CrossCheckValidatorInclusionReason,
	CrossCheckValidatorsDTO
} from '../../domain/CrossCheckValidator.js';

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
		const mappedValidators = validators.slice(0, limit).map(mapValidatorNode);

		return ok({
			generatedAt: new Date().toISOString(),
			limit,
			count: mappedValidators.length,
			totalEligibleCount: validators.length,
			probe: 'not_run',
			comparisonStatus: 'not_compared',
			evidenceSelection:
				'latest_network_snapshot_validator_or_validating_or_active_in_scp',
			validators: mappedValidators
		});
	}

	private normalizeLimit(limit: number | undefined): number {
		if (limit === undefined) return GetCrossCheckValidators.defaultLimit;

		return Math.min(limit, GetCrossCheckValidators.maxLimit);
	}
}

function isValidatorLikeNode(node: NodeV1): boolean {
	return node.isValidator || node.isValidating || node.activeInScp;
}

function mapValidatorNode(node: NodeV1): CrossCheckValidatorDTO {
	return {
		publicKey: node.publicKey,
		comparisonStatus: 'not_compared',
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas: {
			active: node.active,
			activeInScp: node.activeInScp,
			alias: node.alias,
			connectivityError: node.connectivityError,
			historyArchiveHasError: node.historyArchiveHasError,
			historyUrl: node.historyUrl,
			homeDomain: node.homeDomain,
			host: node.host,
			inclusionReasons: getInclusionReasons(node),
			index: node.index,
			isFullValidator: node.isFullValidator,
			isValidating: node.isValidating,
			isValidator: node.isValidator,
			lag: node.lag,
			name: node.name,
			organizationId: node.organizationId,
			publicKey: node.publicKey,
			quorumSetHashKey: node.quorumSetHashKey,
			stellarCoreVersionBehind: node.stellarCoreVersionBehind,
			validatorEvidenceStatus: getValidatorEvidenceStatus(node),
			versionStr: node.versionStr
		}
	};
}

function getValidatorEvidenceStatus(
	node: NodeV1
): CrossCheckValidatorEvidenceStatus {
	if (node.isValidating) return 'validating_observed';
	if (node.isValidator) return 'validator_identity_observed';
	return 'scp_activity_observed';
}

function getInclusionReasons(
	node: NodeV1
): readonly CrossCheckValidatorInclusionReason[] {
	const reasons: CrossCheckValidatorInclusionReason[] = [];
	if (node.isValidator) reasons.push('is_validator');
	if (node.isValidating) reasons.push('is_validating');
	if (node.activeInScp) reasons.push('active_in_scp');

	return reasons;
}
