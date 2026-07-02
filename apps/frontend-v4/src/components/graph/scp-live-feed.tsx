import type { PublicNetwork, PublicScpStatementObservation } from '../../api/types';
import { getNodeLabel } from '../../domain/network';

interface ScpLiveFeedProps {
	activeStatement: PublicScpStatementObservation | null;
	network: PublicNetwork;
	statements: PublicScpStatementObservation[];
}

interface StatementSummary {
	confirm: number;
	externalize: number;
	nominate: number;
	prepare: number;
	slotIndex: string;
	txSetHash: string | null;
}

const getStatementNodeLabel = (
	network: PublicNetwork,
	statement: PublicScpStatementObservation
): string => {
	const node = network.nodes.find((candidate) => candidate.publicKey === statement.nodeId);
	return node ? getNodeLabel(node) : statement.nodeId.slice(0, 12);
};

export const getStatementValueHash = (
	statement: PublicScpStatementObservation
): string => {
	const value = statement.values[0];
	if (value !== undefined) return value.txSetHash.slice(0, 12);

	return statement.statementHash.slice(0, 12);
};

const formatStatementAge = (statement: PublicScpStatementObservation): string => {
	const observedAt = new Date(statement.observedAt).getTime();
	const ageSeconds = Math.max(0, Math.floor((Date.now() - observedAt) / 1000));
	if (ageSeconds < 90) return `${ageSeconds}s`;
	const ageMinutes = Math.floor(ageSeconds / 60);
	if (ageMinutes < 90) return `${ageMinutes}m`;
	return `${Math.floor(ageMinutes / 60)}h`;
};

const summarizeStatements = (
	statements: PublicScpStatementObservation[]
): StatementSummary | null => {
	const firstStatement = statements[0];
	if (!firstStatement) return null;

	const slotStatements = statements.filter(
		(statement) => statement.slotIndex === firstStatement.slotIndex
	);
	const summary: StatementSummary = {
		confirm: 0,
		externalize: 0,
		nominate: 0,
		prepare: 0,
		slotIndex: firstStatement.slotIndex,
		txSetHash: firstStatement.values[0]?.txSetHash ?? null
	};

	for (const statement of slotStatements) {
		if (statement.statementType === 'confirm') summary.confirm += 1;
		if (statement.statementType === 'externalize') summary.externalize += 1;
		if (statement.statementType === 'nominate') summary.nominate += 1;
		if (statement.statementType === 'prepare') summary.prepare += 1;
	}

	return summary;
};

export function ScpLiveFeed({
	activeStatement,
	network,
	statements
}: ScpLiveFeedProps): React.JSX.Element {
	const summary = summarizeStatements(statements);

	return (
		<section className="scp-live-feed" aria-label="SCP live feed">
			<div className="scp-live-heading">
				<h2>SCP live feed</h2>
				<span>{statements.length > 0 ? 'observed' : 'collecting'}</span>
			</div>
			{activeStatement && (
				<div className="scp-flow-focus">
					<span className="flow-pulse" />
					<div>
						<strong>{getStatementNodeLabel(network, activeStatement)}</strong>
						<span>
							{activeStatement.statementType} / slot {activeStatement.slotIndex}
						</span>
					</div>
					<code>{getStatementValueHash(activeStatement)}</code>
				</div>
			)}
			{summary && (
				<div className="scp-slot-summary">
					<div>
						<span>Ledger slot</span>
						<strong>{summary.slotIndex}</strong>
					</div>
					<div>
						<span>Transaction set</span>
						<code>{summary.txSetHash?.slice(0, 18) ?? 'pending'}</code>
					</div>
					<div>
						<span>Nominations</span>
						<strong>{summary.nominate}</strong>
					</div>
					<div>
						<span>Votes</span>
						<strong>
							{summary.prepare + summary.confirm + summary.externalize}
						</strong>
					</div>
				</div>
			)}
			<div className="scp-flow-list">
				{statements.map((statement) => (
					<div
						className={
							statement.statementHash === activeStatement?.statementHash
								? 'active'
								: ''
						}
						key={statement.statementHash}
					>
						<span>{formatStatementAge(statement)}</span>
						<strong>{getStatementNodeLabel(network, statement)}</strong>
						<small>
							{statement.statementType} / slot {statement.slotIndex}
						</small>
					</div>
				))}
				{statements.length === 0 && (
					<p>Waiting for new crawler observations after deployment.</p>
				)}
			</div>
		</section>
	);
}
