import type { PublicNetwork, PublicScpGraphStatement } from '../../api/types';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import { getNodeLabel } from '../../domain/network';
import type { Graph3DNode } from './model-3d';
import { sampleLedgerAnimationStatements } from './graph-statement-sampler';

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
	observedPeer: Graph3DNode | null;
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
	statements: readonly PublicScpGraphStatement[],
	organizationByNodeId?: ReadonlyMap<string, string | null>
): readonly PublicScpGraphStatement[] => {
	return sampleLedgerAnimationStatements(statements, { organizationByNodeId });
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

export const getStatementFlowPath = (
	statement: PublicScpGraphStatement,
	nodesById: ReadonlyMap<string, Graph3DNode>
): StatementFlowPath | null => {
	const signer = nodesById.get(statement.nodeId);
	const observedPeer = nodesById.get(statement.observedFromPeer);
	if (!signer) return null;
	if (signer && observedPeer && signer.id !== observedPeer.id) {
		return {
			label: `${statement.statementType} signed by ${getNodeLabel(signer.node)}; observed through ${getNodeLabel(observedPeer.node)}; relay path unknown`,
			observedPeer,
			statement,
			source: signer,
			target: signer
		};
	}

	if (observedPeer) {
		return {
			label: `${statement.statementType} observed directly from signer`,
			observedPeer,
			statement,
			source: signer,
			target: signer
		};
	}
	return {
		label: `${statement.statementType} observed; relay peer unavailable`,
		observedPeer: null,
		statement,
		source: signer,
		target: signer
	};
};
