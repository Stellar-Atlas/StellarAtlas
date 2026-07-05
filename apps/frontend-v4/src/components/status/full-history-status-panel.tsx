import type { PublicFullHistoryStatus, PublicStatusLevel } from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';

interface FullHistoryStatusPanelProps {
	readonly fullHistory: PublicFullHistoryStatus;
}

export function FullHistoryStatusPanel({
	fullHistory
}: FullHistoryStatusPanelProps): React.JSX.Element {
	return (
		<section className="panel status-full-history-panel">
			<div className="panel-heading">
				<div>
					<strong>Full-History Parser</strong>
					<span>{formatDateTime(fullHistory.generatedAt)}</span>
				</div>
				<StatusPill status={fullHistory.status} />
			</div>
			<div className="status-list">
				<StatusRow
					detail={`${formatInteger(fullHistory.sourceArchiveCount)} archive sources`}
					label="Parsed ledger headers"
					status={fullHistory.status}
					value={formatInteger(fullHistory.parsedLedgerCount)}
				/>
				<StatusRow
					detail={`Earliest ${formatNullableLedger(fullHistory.earliestParsedLedger)}`}
					label="Latest parsed ledger"
					status={fullHistory.status}
					value={formatNullableLedger(fullHistory.latestParsedLedger)}
				/>
				<StatusRow
					detail="Explorer search tables are not ready until these are indexed."
					label="Explorer indexes"
					status={indexesReady(fullHistory) ? 'ok' : 'degraded'}
					value={indexesReady(fullHistory) ? 'Ready' : 'Not ready'}
				/>
				<StatusRow
					detail="Latest parsed header observation"
					label="Observed"
					status={fullHistory.latestObservedAt === null ? 'unavailable' : 'ok'}
					value={formatNullableDate(fullHistory.latestObservedAt)}
				/>
			</div>
		</section>
	);
}

function StatusRow({
	detail,
	label,
	status,
	value
}: {
	readonly detail: string;
	readonly label: string;
	readonly status: PublicStatusLevel;
	readonly value: string;
}): React.JSX.Element {
	return (
		<div className="status-row">
			<div>
				<strong>{label}</strong>
				<small>{detail}</small>
			</div>
			<div className="status-row-value">
				<span>{value}</span>
				<StatusPill status={status} />
			</div>
		</div>
	);
}

function StatusPill({
	status
}: {
	readonly status: PublicStatusLevel;
}): React.JSX.Element {
	return (
		<span className={`status-pill ${statusTone(status)}`}>
			{statusLabel(status)}
		</span>
	);
}

function indexesReady(fullHistory: PublicFullHistoryStatus): boolean {
	return (
		fullHistory.localTransactionIndexReady &&
		fullHistory.localOperationIndexReady &&
		fullHistory.localAssetIndexReady &&
		fullHistory.localContractIndexReady
	);
}

function formatNullableLedger(value: string | null): string {
	return value === null ? 'No data' : formatInteger(Number(value));
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function statusTone(status: PublicStatusLevel): 'good' | 'warning' | 'danger' {
	if (status === 'ok') return 'good';
	if (status === 'degraded') return 'warning';
	return 'danger';
}

function statusLabel(status: PublicStatusLevel): string {
	if (status === 'ok') return 'OK';
	if (status === 'degraded') return 'Degraded';
	return 'Unavailable';
}
