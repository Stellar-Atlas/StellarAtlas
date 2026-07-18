import type { PublicScpGraphStatement } from '../../api/types';

type ScpPhase = PublicScpGraphStatement['statementType'];

interface SampleLedgerStatementsOptions {
	readonly limit?: number;
	readonly organizationByNodeId?: ReadonlyMap<string, string | null>;
}

const phaseOrder: readonly ScpPhase[] = [
	'nominate',
	'prepare',
	'confirm',
	'externalize'
];

export const maxLedgerAnimationStatements = 256;

const compareStatements = (
	left: PublicScpGraphStatement,
	right: PublicScpGraphStatement
): number =>
	Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
	left.statementHash.localeCompare(right.statementHash);

export const sampleLedgerAnimationStatements = (
	statements: readonly PublicScpGraphStatement[],
	options: SampleLedgerStatementsOptions = {}
): readonly PublicScpGraphStatement[] => {
	const requestedLimit = options.limit ?? maxLedgerAnimationStatements;
	const finiteLimit = Number.isFinite(requestedLimit)
		? Math.floor(requestedLimit)
		: maxLedgerAnimationStatements;
	const limit = Math.max(
		phaseOrder.length,
		Math.min(maxLedgerAnimationStatements, finiteLimit)
	);
	const ordered = statements.toSorted(compareStatements);
	if (ordered.length <= limit) return ordered;

	const selected: PublicScpGraphStatement[] = [];
	const selectedHashes = new Set<string>();
	const add = (statement: PublicScpGraphStatement | undefined): void => {
		if (
			statement === undefined ||
			selected.length >= limit ||
			selectedHashes.has(statement.statementHash)
		)
			return;
		selected.push(statement);
		selectedHashes.add(statement.statementHash);
	};

	for (const phase of phaseOrder) {
		add(ordered.find((statement) => statement.statementType === phase));
	}

	const organizationByNodeId = options.organizationByNodeId;
	if (organizationByNodeId !== undefined) {
		const representativeByPhaseAndOrganization = new Map<
			ScpPhase,
			Map<string, PublicScpGraphStatement>
		>();
		for (const statement of ordered) {
			const organizationId = organizationByNodeId.get(statement.nodeId);
			if (!organizationId) continue;
			const representatives =
				representativeByPhaseAndOrganization.get(statement.statementType) ??
				new Map<string, PublicScpGraphStatement>();
			if (!representatives.has(organizationId))
				representatives.set(organizationId, statement);
			representativeByPhaseAndOrganization.set(
				statement.statementType,
				representatives
			);
		}
		for (const phase of phaseOrder) {
			const representatives = representativeByPhaseAndOrganization.get(phase);
			if (!representatives) continue;
			for (const organizationId of Array.from(
				representatives.keys()
			).toSorted()) {
				add(representatives.get(organizationId));
			}
		}
	}

	const representativeByNode = new Map<string, PublicScpGraphStatement>();
	for (const statement of ordered) {
		if (!representativeByNode.has(statement.nodeId)) {
			representativeByNode.set(statement.nodeId, statement);
		}
	}
	const representedNodes = new Set(
		selected.map((statement) => statement.nodeId)
	);
	for (const nodeId of Array.from(representativeByNode.keys()).toSorted()) {
		if (representedNodes.has(nodeId)) continue;
		add(representativeByNode.get(nodeId));
		representedNodes.add(nodeId);
	}

	for (const statement of ordered) add(statement);
	return selected.toSorted(compareStatements);
};
