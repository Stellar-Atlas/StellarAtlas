import type { Graph3DNode } from './model-3d';
import {
	compareStatementsByObservation,
	getStatementFlowPath,
	ledgerCloseAnimationBudgetMs,
	ledgerPlaybackDurationMs,
	type LedgerPlaybackFrame,
	type StatementFlowPath
} from './scp-flow-paths';
import type { PublicScpGraphStatement } from '../../api/types';
import { sampleLedgerAnimationStatements } from './graph-statement-sampler';

export interface StatementWaveScheduleEntry {
	readonly delayMs: number;
	readonly flowPath: StatementFlowPath;
	readonly statement: PublicScpGraphStatement;
}

interface BuildStatementWaveScheduleOptions {
	readonly animatedStatementHashes: ReadonlySet<string>;
	readonly elapsedMs: number;
	readonly ledger: LedgerPlaybackFrame;
	readonly nodesById: ReadonlyMap<string, Graph3DNode>;
	readonly organizationByNodeId: ReadonlyMap<string, string | null>;
}

const activeStatementLifetimeMs = 1_700;
export const statementLaunchSafetyMarginMs = 120;

export const buildStatementWaveSchedule = ({
	animatedStatementHashes,
	elapsedMs,
	ledger,
	nodesById,
	organizationByNodeId
}: BuildStatementWaveScheduleOptions): readonly StatementWaveScheduleEntry[] => {
	const playbackDurationMs =
		ledger.playbackDurationMs ?? ledgerPlaybackDurationMs;
	const latestLaunchMs = Math.max(
		0,
		playbackDurationMs - activeStatementLifetimeMs
	);

	const animationBudgetMs =
		ledger.animationBudgetMs ?? ledgerCloseAnimationBudgetMs;
	const scheduleWindowMs = Math.max(
		0,
		Math.min(animationBudgetMs, latestLaunchMs) - statementLaunchSafetyMarginMs
	);
	const remainingWindowMs = Math.max(0, scheduleWindowMs - elapsedMs);
	const candidates = sampleLedgerAnimationStatements(ledger.statements, {
		organizationByNodeId
	})
		.filter(
			(statement) => !animatedStatementHashes.has(statement.statementHash)
		)
		.toSorted(compareStatementsByObservation)
		.map((statement) => {
			const flowPath = getStatementFlowPath(statement, nodesById);
			return flowPath ? { flowPath, statement } : null;
		})
		.filter(
			(
				entry
			): entry is {
				flowPath: StatementFlowPath;
				statement: PublicScpGraphStatement;
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
