import Link from 'next/link';
import type { PublicScpStatementObservation } from '../../api/types';
import { getNodeLabel, getNodeTags } from '../../domain/network';
import { formatInteger, formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';
import type { GraphQuorumRow } from './graph-quorum';
import type { Graph3DNode } from './model-3d';
import { getStatementValueHash } from './scp-live-feed';

interface GraphNodePopoverProps {
	onClose: () => void;
	selectedNode: Graph3DNode;
	selectedNodeStatements: readonly PublicScpStatementObservation[];
	selectedQuorumNodeIds: ReadonlySet<string>;
	selectedQuorumRows: readonly GraphQuorumRow[];
}

const formatAvailability = (hasStats: boolean, value: number): string =>
	hasStats ? formatPercent(value) : 'Collecting';

const formatNullableInteger = (value: number | null): string =>
	value === null ? 'Unknown' : formatInteger(value);

const formatLag = (value: number | null): string =>
	value === null
		? 'Unknown'
		: value === 0
			? '0 ms reported'
			: `${formatInteger(value)} ms`;

export function GraphNodePopover({
	onClose,
	selectedNode,
	selectedNodeStatements,
	selectedQuorumNodeIds,
	selectedQuorumRows
}: GraphNodePopoverProps): React.JSX.Element {
	return (
		<section className="graph-overlay node-popover">
			<button className="close-button" onClick={onClose} type="button">
				x
			</button>
			<p className="eyebrow">{selectedNode.kind}</p>
			<h2>{getNodeLabel(selectedNode.node)}</h2>
			<StatusTags tags={getNodeTags(selectedNode.node)} />
			<dl className="compact-details">
				<div>
					<dt>Organization</dt>
					<dd>{selectedNode.groupName}</dd>
				</div>
				<div>
					<dt>Public key</dt>
					<dd>{selectedNode.id}</dd>
				</div>
				<div>
					<dt>Host</dt>
					<dd>{selectedNode.node.host ?? selectedNode.node.ip}</dd>
				</div>
				<div>
					<dt>Version</dt>
					<dd>{selectedNode.node.versionStr ?? 'Unknown'}</dd>
				</div>
				<div>
					<dt>Protocol</dt>
					<dd>{formatNullableInteger(selectedNode.node.ledgerVersion)}</dd>
				</div>
				<div>
					<dt>Lag</dt>
					<dd>{formatLag(selectedNode.node.lag)}</dd>
				</div>
				<div>
					<dt>Home domain</dt>
					<dd>{selectedNode.node.homeDomain ?? 'Not reported'}</dd>
				</div>
				<div>
					<dt>Country</dt>
					<dd>{selectedNode.node.geoData?.countryName ?? 'Unknown'}</dd>
				</div>
				<div>
					<dt>24H active</dt>
					<dd>
						{formatAvailability(
							selectedNode.node.statistics.has24HourStats,
							selectedNode.node.statistics.active24HoursPercentage
						)}
					</dd>
				</div>
				<div>
					<dt>30D validating</dt>
					<dd>
						{formatAvailability(
							selectedNode.node.statistics.has30DayStats,
							selectedNode.node.statistics.validating30DaysPercentage
						)}
					</dd>
				</div>
				<div>
					<dt>Archive</dt>
					<dd>{selectedNode.node.historyUrl ?? 'Not reported'}</dd>
				</div>
				<div>
					<dt>SCP evidence</dt>
					<dd>{selectedNodeStatements.length} recent statements</dd>
				</div>
			</dl>
			{selectedQuorumRows.length > 0 && (
				<div className="node-quorum-table">
					<div className="node-panel-heading">
						<strong>Quorum set</strong>
						<span>{formatInteger(selectedQuorumNodeIds.size)} validators</span>
					</div>
					{selectedQuorumRows.slice(0, 6).map((row) => (
						<div
							className="quorum-row"
							key={row.id}
							style={{ paddingLeft: `${row.depth * 10}px` }}
						>
							<span>
								{row.threshold} of {row.totalEntries}
							</span>
							<div>
								{row.validators.slice(0, 8).map((validator) => (
									<em key={validator.id}>
										{validator.label} / {validator.organization}
									</em>
								))}
								{row.validators.length === 0 && <em>Nested quorum set</em>}
							</div>
						</div>
					))}
				</div>
			)}
			{selectedNodeStatements.length > 0 && (
				<div className="node-scp-feed">
					{selectedNodeStatements.map((statement) => (
						<div key={statement.statementHash}>
							<strong>{statement.statementType}</strong>
							<span>slot {statement.slotIndex}</span>
							<code>{getStatementValueHash(statement)}</code>
						</div>
					))}
				</div>
			)}
			<Link
				className="primary-button"
				href={`/nodes/${encodeURIComponent(selectedNode.id)}`}
			>
				Open node details
			</Link>
		</section>
	);
}
