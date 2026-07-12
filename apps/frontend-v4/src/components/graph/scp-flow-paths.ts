import type { PublicNetwork, PublicScpGraphStatement } from '../../api/types';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import { getNodeLabel } from '../../domain/network';
import type { Graph3DLink, Graph3DNode } from './model-3d';
import { getEndpointId, getGraphLinkKey } from './graph-link-utils';

export const maxActiveFeedStatements = 8;
export const ledgerPlaybackDurationMs = 5_000;
export const ledgerCloseAnimationBudgetMs = 3_300;

export interface LedgerPlaybackFrame {
	animationBudgetMs?: number;
	playbackDurationMs?: number;
	slotIndex: string;
	statements: readonly PublicScpGraphStatement[];
}

export interface StatementFlowPath {
	label: string;
	statement: PublicScpGraphStatement;
	source: Graph3DNode;
	target: Graph3DNode;
}

export const getStatementColor = (
	statementType: PublicScpGraphStatement['statementType']
): string => {
	if (statementType === 'nominate') return '#f7cf4d';
	if (statementType === 'prepare') return '#58a6ff';
	if (statementType === 'confirm') return '#5dd39e';
	return '#c084fc';
};

export const compareStatementsByObservation = (
	left: PublicScpGraphStatement,
	right: PublicScpGraphStatement
): number =>
	new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime() ||
	left.statementHash.localeCompare(right.statementHash);

export const selectLedgerAnimationStatements = (
	statements: readonly PublicScpGraphStatement[]
): readonly PublicScpGraphStatement[] => {
	return statements.toSorted(compareStatementsByObservation);
};

export const getLatestSlotIndex = (
	statements: readonly PublicScpGraphStatement[]
): string | null =>
	getHighestLedgerSequence(statements.map((statement) => statement.slotIndex));

export const getDisplayLedger = (
	network: PublicNetwork,
	statements: readonly PublicScpGraphStatement[],
	latestLedger: string | null
): PublicNetwork['latestLedger'] => {
	const highest = getHighestLedgerSequence([
		network.latestLedger,
		getLatestSlotIndex(statements),
		latestLedger
	]);
	return highest ?? network.latestLedger.toString();
};

const findStatementFallbackLink = (
	statement: PublicScpGraphStatement,
	links: readonly Graph3DLink[],
	nodesById: ReadonlyMap<string, Graph3DNode>
): Graph3DLink | null => {
	const outgoing = links.find(
		(link) =>
			getEndpointId(link.source) === statement.nodeId &&
			nodesById.has(getEndpointId(link.target) ?? '')
	);
	if (outgoing) return outgoing;

	const incoming = links.find(
		(link) =>
			getEndpointId(link.target) === statement.nodeId &&
			nodesById.has(getEndpointId(link.source) ?? '')
	);
	return incoming ?? null;
};

export const getStatementFlowPath = (
	statement: PublicScpGraphStatement,
	links: readonly Graph3DLink[],
	nodesById: ReadonlyMap<string, Graph3DNode>
): StatementFlowPath | null => {
	const signer = nodesById.get(statement.nodeId);
	const observedPeer = nodesById.get(statement.observedFromPeer);
	if (signer && observedPeer && signer.id !== observedPeer.id) {
		return {
			label: `${statement.statementType} observed through ${getNodeLabel(observedPeer.node)}`,
			statement,
			source: signer,
			target: observedPeer
		};
	}

	const fallbackLink = findStatementFallbackLink(statement, links, nodesById);
	if (!fallbackLink) {
		if (!signer) return null;
		return {
			label: `${statement.statementType} observed`,
			statement,
			source: signer,
			target: signer
		};
	}

	const sourceId = getEndpointId(fallbackLink.source);
	const targetId = getEndpointId(fallbackLink.target);
	if (!sourceId || !targetId) return null;
	const source = nodesById.get(sourceId);
	const target = nodesById.get(targetId);
	if (!source || !target) return null;

	return {
		label: fallbackLink.label,
		statement,
		source,
		target
	};
};

export const getExistingFlowLinkKeys = (
	path: StatementFlowPath,
	links: readonly Graph3DLink[]
): string[] =>
	links
		.filter((link) => {
			const sourceId = getEndpointId(link.source);
			const targetId = getEndpointId(link.target);
			return (
				(sourceId === path.source.id && targetId === path.target.id) ||
				(sourceId === path.target.id && targetId === path.source.id)
			);
		})
		.map(getGraphLinkKey);
