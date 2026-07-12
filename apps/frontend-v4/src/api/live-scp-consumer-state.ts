import type {
	PublicScpGraphStatement,
	PublicScpStatementReadMetadata
} from './types';
import type { LiveNetworkMessage } from './live-network-message-parser';

export interface LiveScpConsumerState {
	readonly metadata: PublicScpStatementReadMetadata | null;
	readonly statements: PublicScpGraphStatement[];
}

const maxRetainedStatements = 4_000;

export const createLiveScpConsumerState = (
	statements: readonly PublicScpGraphStatement[]
): LiveScpConsumerState => ({ metadata: null, statements: [...statements] });

export const applyLiveScpMessage = (
	current: LiveScpConsumerState,
	message: Extract<LiveNetworkMessage, { type: 'scp' }>
): LiveScpConsumerState => ({
	metadata: {
		freshness: message.freshness,
		freshnessMs: message.freshnessMs,
		observedAt: message.observedAt,
		source: message.source
	},
	statements: mergeStatements(current.statements, message.payload)
});

const mergeStatements = (
	current: readonly PublicScpGraphStatement[],
	next: readonly PublicScpGraphStatement[]
): PublicScpGraphStatement[] => {
	const byHash = new Map(
		current.map((statement) => [statement.statementHash, statement])
	);
	for (const statement of next) byHash.set(statement.statementHash, statement);
	return Array.from(byHash.values())
		.toSorted(compareStatementsNewestFirst)
		.slice(0, maxRetainedStatements);
};

const compareStatementsNewestFirst = (
	left: PublicScpGraphStatement,
	right: PublicScpGraphStatement
): number =>
	toSortableTime(right.observedAt) - toSortableTime(left.observedAt) ||
	right.statementHash.localeCompare(left.statementHash);

const toSortableTime = (value: string): number => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};
