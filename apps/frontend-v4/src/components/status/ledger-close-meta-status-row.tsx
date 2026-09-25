import type { PublicFullHistoryStatus } from '@api/types';
import { formatInteger } from '@format/formatters';
import { useLocalDateTimeFormatter } from '../local-date-time';
import { StatusRow } from './status-ui';

export function LedgerCloseMetaStatusRow({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	const coverage = fullHistory.ledgerCloseMeta;
	if (coverage === null) {
		return (
			<StatusRow
				label="Retained source lake"
				status="unavailable"
				value="Coverage unavailable"
				detail="Retained ledger-close metadata coverage has not loaded; this does not establish whether data is missing or ingestion is stopped."
			/>
		);
	}
	const recordCount = coverage.outputs.reduce(
		(sum, output) => sum + BigInt(output.recordCount),
		0n
	);
	const continuousRange =
		coverage.contiguousFirstLedger === null ||
		coverage.contiguousLastLedger === null
			? 'No continuous decoded range'
			: `${formatInteger(Number(coverage.contiguousFirstLedger))} - ${formatInteger(Number(coverage.contiguousLastLedger))}`;
	const supplementalDetail =
		BigInt(coverage.supplementalLedgerCount) === 0n
			? ''
			: `; ${formatUnsigned(coverage.supplementalLedgerCount)} supplemental near-head ledgers are also decoded through ${formatNullableLedger(coverage.lastLedger)}`;
	return (
		<StatusRow
			detail={`${formatUnsigned(coverage.contiguousLedgerCount)} continuous ledgers in ${formatInteger(coverage.batchCount)} immutable batches${supplementalDetail}; ${formatUnsigned(recordCount.toString())} decoded file rows across ${formatInteger(coverage.outputs.length)} source datasets; updated ${formatDateTime(coverage.updatedAt)}. Persisted coverage, not live importer status or parsed analytics coverage.`}
			label="Retained source lake"
			pillText="Persisted"
			status="ok"
			value={continuousRange}
		/>
	);
}

function formatUnsigned(value: string): string {
	return BigInt(value).toLocaleString('en-US');
}

function formatNullableLedger(value: string | null): string {
	return value === null ? 'an unknown ledger' : formatInteger(Number(value));
}
