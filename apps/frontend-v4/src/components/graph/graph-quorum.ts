import type { BaseQuorumSet } from 'shared';
import { getNodeLabel } from '../../domain/network';
import type { Graph3DNode } from './model-3d';

export interface GraphQuorumRow {
	readonly depth: number;
	readonly id: string;
	readonly threshold: number;
	readonly totalEntries: number;
	readonly validators: readonly {
		readonly id: string;
		readonly label: string;
		readonly organization: string;
	}[];
}

export const collectQuorumValidatorIds = (
	quorumSet: BaseQuorumSet | null
): ReadonlySet<string> => {
	const validators = new Set<string>();
	collectQuorumValidatorIdsInto(quorumSet, validators);
	return validators;
};

export const buildQuorumRows = (
	quorumSet: BaseQuorumSet | null,
	nodesById: ReadonlyMap<string, Graph3DNode>
): readonly GraphQuorumRow[] => {
	if (!quorumSet) return [];
	const rows: GraphQuorumRow[] = [];
	collectQuorumRows(quorumSet, nodesById, rows, 0, 'root');
	return rows;
};

function collectQuorumValidatorIdsInto(
	quorumSet: BaseQuorumSet | null,
	validators: Set<string>
): void {
	if (!quorumSet) return;
	for (const validator of quorumSet.validators) validators.add(validator);
	for (const innerSet of quorumSet.innerQuorumSets) {
		collectQuorumValidatorIdsInto(innerSet, validators);
	}
}

function collectQuorumRows(
	quorumSet: BaseQuorumSet,
	nodesById: ReadonlyMap<string, Graph3DNode>,
	rows: GraphQuorumRow[],
	depth: number,
	id: string
): void {
	rows.push({
		depth,
		id,
		threshold: quorumSet.threshold,
		totalEntries: quorumSet.validators.length + quorumSet.innerQuorumSets.length,
		validators: quorumSet.validators.map((validator) => {
			const node = nodesById.get(validator);
			return {
				id: validator,
				label: node ? getNodeLabel(node.node) : validator.slice(0, 12),
				organization: node?.groupName ?? 'Unknown organization'
			};
		})
	});

	quorumSet.innerQuorumSets.forEach((innerSet, index) => {
		collectQuorumRows(innerSet, nodesById, rows, depth + 1, `${id}.${index}`);
	});
}
