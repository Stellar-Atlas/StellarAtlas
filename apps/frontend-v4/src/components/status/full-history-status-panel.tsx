import type { PublicFullHistoryStatus, PublicStatusLevel } from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill, StatusRow } from './status-ui';

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
					<strong>Full-History Header Parser</strong>
					<span>{formatDateTime(fullHistory.generatedAt)}</span>
				</div>
				<StatusPill
					status={parserStatus(fullHistory)}
					text={
						fullHistory.parsedLedgerCount > 0 && !indexesReady(fullHistory)
							? 'Header-only'
							: undefined
					}
				/>
			</div>
			<div className="status-list">
				<StatusRow
					detail={`${formatInteger(fullHistory.sourceArchiveCount)} archive sources`}
					label="Parsed ledger headers"
					status={parserStatus(fullHistory)}
					value={formatInteger(fullHistory.parsedLedgerCount)}
				/>
				<StatusRow
					detail={`Earliest ${formatNullableLedger(fullHistory.earliestParsedLedger)}`}
					label="Latest parsed ledger"
					status={fullHistory.status}
					value={formatNullableLedger(fullHistory.latestParsedLedger)}
				/>
				<StatusRow
					detail="Transaction, operation, asset, and contract indexes are roadmap read models, not current scanner health."
					label="Explorer indexes"
					pillText={indexesReady(fullHistory) ? undefined : 'Planned'}
					status="ok"
					value={indexesReady(fullHistory) ? 'Ready' : 'Planned'}
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

function indexesReady(fullHistory: PublicFullHistoryStatus): boolean {
	return (
		fullHistory.localTransactionIndexReady &&
		fullHistory.localOperationIndexReady &&
		fullHistory.localAssetIndexReady &&
		fullHistory.localContractIndexReady
	);
}

function parserStatus(fullHistory: PublicFullHistoryStatus): PublicStatusLevel {
	if (fullHistory.parsedLedgerCount > 0) return 'ok';
	return fullHistory.status;
}

function formatNullableLedger(value: string | null): string {
	return value === null ? 'No data' : formatInteger(Number(value));
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}
