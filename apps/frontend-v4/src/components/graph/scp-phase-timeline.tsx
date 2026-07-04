import type {
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import { getNodeLabel } from '../../domain/network';

interface ScpPhaseTimelineProps {
	activeSlotIndex: string | null;
	activeStatements: readonly PublicScpStatementObservation[];
	fallbackSlotIndex: string | null;
	focusedStatement: PublicScpStatementObservation | null;
	network: PublicNetwork;
	statements: readonly PublicScpStatementObservation[];
}

type ScpPhase = PublicScpStatementObservation['statementType'];

const phaseOrder: readonly ScpPhase[] = [
	'nominate',
	'prepare',
	'confirm',
	'externalize'
];

const phaseLabels: Record<ScpPhase, string> = {
	confirm: 'Confirm',
	externalize: 'Externalize',
	nominate: 'Nominate',
	prepare: 'Prepare'
};

const compareByObservation = (
	left: PublicScpStatementObservation,
	right: PublicScpStatementObservation
): number =>
	new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime() ||
	left.statementHash.localeCompare(right.statementHash);

const getStatementNodeLabel = (
	network: PublicNetwork,
	statement: PublicScpStatementObservation
): string => {
	const node = network.nodes.find(
		(candidate) => candidate.publicKey === statement.nodeId
	);
	return node ? getNodeLabel(node) : statement.nodeId.slice(0, 12);
};

const distinctNodeStatements = (
	statements: readonly PublicScpStatementObservation[]
): readonly PublicScpStatementObservation[] => {
	const byNode = new Map<string, PublicScpStatementObservation>();
	for (const statement of statements) byNode.set(statement.nodeId, statement);
	return Array.from(byNode.values()).toSorted(compareByObservation).slice(-4);
};

export function ScpPhaseTimeline({
	activeSlotIndex,
	activeStatements,
	fallbackSlotIndex,
	focusedStatement,
	network,
	statements
}: ScpPhaseTimelineProps): React.JSX.Element | null {
	const activeStatement = activeStatements.at(0) ?? null;
	const slotIndex =
		activeSlotIndex ??
		activeStatement?.slotIndex ??
		focusedStatement?.slotIndex ??
		fallbackSlotIndex;
	if (!slotIndex) return null;

	const slotStatements = statements
		.filter((statement) => statement.slotIndex === slotIndex)
		.toSorted(compareByObservation);

	return (
		<div
			aria-label={`SCP phase timeline for ledger ${slotIndex}`}
			className="scp-phase-timeline"
		>
			{phaseOrder.map((phase) => {
				const phaseStatements = slotStatements.filter(
					(statement) => statement.statementType === phase
				);
				const activePhaseStatements = activeStatements.filter(
					(statement) =>
						statement.slotIndex === slotIndex && statement.statementType === phase
				);
				const focusedPhaseStatement =
					focusedStatement?.slotIndex === slotIndex &&
					focusedStatement.statementType === phase
						? focusedStatement
						: null;
				const displayStatements = distinctNodeStatements(
					activePhaseStatements.length > 0
						? activePhaseStatements
						: focusedPhaseStatement
							? [...phaseStatements, focusedPhaseStatement]
						: phaseStatements
				);
				const isActive =
					activePhaseStatements.length > 0 || focusedPhaseStatement !== null;

				return (
					<div
						className={
							isActive
								? `scp-phase-card ${phase} active`
								: `scp-phase-card ${phase}`
						}
						key={phase}
					>
						<div className="scp-phase-card-heading">
							<span className={`flow-pulse ${phase}`} />
							<div>
								<strong>{phaseLabels[phase]}</strong>
								<span>{slotIndex}</span>
							</div>
							<code>{phaseStatements.length}</code>
						</div>
						<div className="scp-phase-card-nodes">
							{displayStatements.map((statement) => (
								<span key={statement.statementHash} title={statement.nodeId}>
									{getStatementNodeLabel(network, statement)}
								</span>
							))}
							{displayStatements.length === 0 && (
								<span className="scp-phase-empty">pending</span>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
