import Link from 'next/link';
import type {
	PublicHistoryArchiveScanLogEntry,
	PublicScpStatementObservation
} from '../../api/types';
import {
	getArchiveVerificationErrors,
	getWorkerIssues,
	scanLogHasArchiveVerificationError,
	scanLogHasWorkerIssueOnly,
	scanLogIsActive
} from '../../domain/history-archive';
import { getNodeLabel, getNodeTags } from '../../domain/network';
import { formatInteger, formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';
import type { GraphQuorumRow } from './graph-quorum';
import type { Graph3DNode } from './model-3d';
import { getStatementValueHash } from './scp-live-feed';

type HistoryLogStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface GraphNodePopoverProps {
	onClose: () => void;
	onToggleHistoryErrorsOnly: () => void;
	selectedHistoryLogStatus: HistoryLogStatus;
	selectedHistoryLogs: readonly PublicHistoryArchiveScanLogEntry[];
	selectedNode: Graph3DNode;
	selectedNodeHasArchiveErrors: boolean;
	selectedNodeStatements: readonly PublicScpStatementObservation[];
	selectedQuorumNodeIds: ReadonlySet<string>;
	selectedQuorumRows: readonly GraphQuorumRow[];
	showHistoryErrorsOnly: boolean;
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

const formatShortDateTime = (value: string): string =>
	new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(value));

const formatDuration = (durationMs: number): string => {
	if (durationMs < 1000) return `${formatInteger(durationMs)} ms`;
	const seconds = Math.round(durationMs / 1000);
	if (seconds < 90) return `${formatInteger(seconds)}s`;
	return `${formatInteger(Math.round(seconds / 60))}m`;
};

const getVisibleHistoryLogs = (
	selectedHistoryLogs: readonly PublicHistoryArchiveScanLogEntry[],
	showHistoryErrorsOnly: boolean
): readonly PublicHistoryArchiveScanLogEntry[] =>
	(showHistoryErrorsOnly
		? selectedHistoryLogs.filter(
				(log) =>
					scanLogIsActive(log) ||
					scanLogHasArchiveVerificationError(log) ||
					scanLogHasWorkerIssueOnly(log)
			)
		: selectedHistoryLogs
	).slice(0, 6);

export function GraphNodePopover({
	onClose,
	onToggleHistoryErrorsOnly,
	selectedHistoryLogStatus,
	selectedHistoryLogs,
	selectedNode,
	selectedNodeHasArchiveErrors,
	selectedNodeStatements,
	selectedQuorumNodeIds,
	selectedQuorumRows,
	showHistoryErrorsOnly
}: GraphNodePopoverProps): React.JSX.Element {
	const visibleHistoryLogs = getVisibleHistoryLogs(
		selectedHistoryLogs,
		showHistoryErrorsOnly
	);

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
					<dt>Archive status</dt>
					<dd>
						{selectedNodeHasArchiveErrors
							? 'Archive warning'
							: 'No archive warning'}
					</dd>
				</div>
				<div>
					<dt>SCP evidence</dt>
					<dd>{selectedNodeStatements.length} recent statements</dd>
				</div>
			</dl>
			{selectedNode.node.historyUrl && (
				<div className="node-scan-log">
					<div className="node-panel-heading">
						<strong>History scan runs</strong>
						<button
							className={
								showHistoryErrorsOnly
									? 'scan-log-toggle active'
									: 'scan-log-toggle'
							}
							onClick={onToggleHistoryErrorsOnly}
							type="button"
						>
							Errors only
						</button>
					</div>
					{visibleHistoryLogs.length > 0 ? (
						visibleHistoryLogs.map((historyLog) => {
							const isActive = scanLogIsActive(historyLog);
							const archiveErrors = getArchiveVerificationErrors(
								historyLog.errors
							);
							const workerIssues = getWorkerIssues(historyLog.errors);
							const hasArchiveErrors = archiveErrors.length > 0;
							const hasWorkerIssues = workerIssues.length > 0;
							const visibleErrors = hasArchiveErrors
								? archiveErrors
								: workerIssues;
							let scanLogCardClassName = 'scan-log-card good';
							let scanLogLabel = 'No archive errors';

							if (isActive) {
								scanLogCardClassName = 'scan-log-card active';
								scanLogLabel =
									historyLog.status === 'scanning'
										? 'Scanning now'
										: 'Queued scan';
							} else if (hasArchiveErrors) {
								scanLogCardClassName = 'scan-log-card warning';
								scanLogLabel = 'Archive errors';
							} else if (hasWorkerIssues) {
								scanLogCardClassName = 'scan-log-card warning';
								scanLogLabel = scanLogHasWorkerIssueOnly(historyLog)
									? 'Worker issue'
									: 'Archive + worker issue';
							}

							return (
								<div
									className={scanLogCardClassName}
									key={`${historyLog.startDate}-${historyLog.latestScannedLedger}`}
								>
									<span>{scanLogLabel}</span>
									<strong>
										{formatInteger(historyLog.latestVerifiedLedger)} latest
										verified
									</strong>
									<small>
										{formatShortDateTime(historyLog.endDate)} /{' '}
										{formatDuration(historyLog.durationMs)} /{' '}
										{formatInteger(historyLog.concurrency)} requests
									</small>
									{visibleErrors.length > 0 && (
										<code>{visibleErrors[0]?.message}</code>
									)}
								</div>
							);
						})
					) : (
						<p>
							{selectedHistoryLogStatus === 'loading'
								? 'Loading scan log...'
								: 'No matching scan runs returned.'}
						</p>
					)}
				</div>
			)}
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
