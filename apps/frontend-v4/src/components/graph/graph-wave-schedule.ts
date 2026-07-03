import type { Graph3DNode } from './model-3d';
import type { GraphRenderData } from './use-graph-renderer';
import {
	compareStatementsByObservation,
	getStatementFlowPath,
	ledgerCloseAnimationBudgetMs,
	ledgerPlaybackDurationMs,
	type LedgerPlaybackFrame,
	type StatementFlowPath
} from './scp-flow-paths';
import type { PublicScpStatementObservation } from '../../api/types';

export interface StatementWaveScheduleEntry {
	readonly delayMs: number;
	readonly flowPath: StatementFlowPath;
	readonly statement: PublicScpStatementObservation;
}

interface BuildStatementWaveScheduleOptions {
	readonly animatedStatementHashes: ReadonlySet<string>;
	readonly elapsedMs: number;
	readonly graphData: GraphRenderData;
	readonly ledger: LedgerPlaybackFrame;
	readonly nodesById: ReadonlyMap<string, Graph3DNode>;
}

const activeStatementLifetimeMs = 1_700;

export const buildStatementWaveSchedule = ({
	animatedStatementHashes,
	elapsedMs,
	graphData,
	ledger,
	nodesById
}: BuildStatementWaveScheduleOptions): readonly StatementWaveScheduleEntry[] => {
	const playbackDurationMs =
		ledger.playbackDurationMs ?? ledgerPlaybackDurationMs;
	const latestLaunchMs = Math.max(
		0,
		playbackDurationMs - activeStatementLifetimeMs
	);
	if (elapsedMs > latestLaunchMs) return [];

	const animationBudgetMs =
		ledger.animationBudgetMs ?? ledgerCloseAnimationBudgetMs;
	const scheduleWindowMs = Math.min(animationBudgetMs, latestLaunchMs);
	const remainingWindowMs = Math.max(0, scheduleWindowMs - elapsedMs);
	const candidates = ledger.statements
		.filter(
			(statement) => !animatedStatementHashes.has(statement.statementHash)
		)
		.toSorted(compareStatementsByObservation)
		.map((statement) => {
			const flowPath = getStatementFlowPath(
				statement,
				graphData.links,
				nodesById
			);
			return flowPath ? { flowPath, statement } : null;
		})
		.filter(
			(
				entry
			): entry is {
				flowPath: StatementFlowPath;
				statement: PublicScpStatementObservation;
			} => entry !== null
		);

	const denominator = Math.max(1, candidates.length - 1);
	return candidates.map((entry, index) => ({
		...entry,
		delayMs: Math.max(
			0,
			Math.min(
				Math.floor((index / denominator) * remainingWindowMs),
				latestLaunchMs - elapsedMs
			)
		)
	}));
};
