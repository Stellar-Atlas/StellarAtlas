import type { PublicFullHistoryStatus } from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusRow } from './status-ui';

export function LedgerCloseMetaStatusRow({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element | null {
	const coverage = fullHistory.ledgerCloseMeta;
	if (coverage === null) return null;
	const recordCount = coverage.outputs.reduce(
		(sum, output) => sum + BigInt(output.recordCount),
		0n
	);
	const range =
		coverage.firstLedger === null || coverage.lastLedger === null
			? 'No decoded range'
			: `${formatInteger(Number(coverage.firstLedger))} - ${formatInteger(Number(coverage.lastLedger))}`;
	return (
		<StatusRow
			detail={`${formatUnsigned(coverage.ledgerCount)} ledgers in ${formatInteger(coverage.batchCount)} immutable batches; ${formatUnsigned(recordCount.toString())} decoded dataset rows across ${formatInteger(coverage.outputs.length)} typed datasets; updated ${formatDateTime(coverage.updatedAt)}`}
			label="Decoded history ingestion"
			pillText="Persisted"
			status="ok"
			value={range}
		/>
	);
}

function formatUnsigned(value: string): string {
	return BigInt(value).toLocaleString('en-US');
}
