import type {
	PublicFullHistoryCanonicalStateLinkageStatus,
	PublicFullHistoryStateImportStatus,
	PublicFullHistoryStatus
} from '@api/types';
import { formatInteger } from '@format/formatters';
import { useLocalDateTimeFormatter } from '../local-date-time';
import { StatusRow, type StatusPillTone } from './status-ui';

export function LedgerCloseMetaStateStatusRows({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element {
	const state = fullHistory.ledgerCloseMetaState;
	if (
		fullHistory.status === 'unavailable' &&
		state.imports.lifecycle.total === 0 &&
		state.canonicalLinkage.lifecycle.total === 0
	) {
		return (
			<StatusRow
				label="State import and linkage records"
				status="unavailable"
				value="Telemetry unavailable"
				detail="Import and linkage records have not loaded; no empty-state conclusion is available."
			/>
		);
	}
	return (
		<>
			<StateImportRow imports={state.imports} />
			<CanonicalStateLinkageRow linkage={state.canonicalLinkage} />
		</>
	);
}

function StateImportRow({
	imports
}: {
	readonly imports: PublicFullHistoryStateImportStatus;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	const lifecycle = imports.lifecycle;
	const empty = lifecycle.total === 0;
	const failed = lifecycle.failed > 0;
	const active = lifecycle.importing > 0;
	const waiting = lifecycle.pending > 0;
	return (
		<StatusRow
			detail={
				empty
					? 'No account or trustline change batch has been registered for import yet.'
					: `Last recorded: ${formatInteger(lifecycle.importing)} importing, ${formatInteger(lifecycle.pending)} queued, ${formatInteger(lifecycle.failed)} failed. Updated ${formatNullableDate(imports.latestUpdatedAt, formatDateTime)}; not live worker status.`
			}
			label="Account and trustline state (recorded)"
			pillText={
				empty
					? 'Awaiting data'
					: failed
						? 'Needs attention'
						: active
							? 'Recorded importing'
							: waiting
								? 'Queued'
								: 'Imported'
			}
			status={failed ? 'degraded' : 'ok'}
			tone={progressTone(empty, failed, active || waiting)}
			value={
				empty
					? 'Awaiting decoded state batches'
					: `${formatInteger(lifecycle.complete)} / ${formatInteger(lifecycle.total)} imports complete`
			}
		/>
	);
}

function CanonicalStateLinkageRow({
	linkage
}: {
	readonly linkage: PublicFullHistoryCanonicalStateLinkageStatus;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	const lifecycle = linkage.lifecycle;
	const empty = lifecycle.total === 0;
	const failed = lifecycle.failed > 0;
	const active = lifecycle.checking > 0;
	const waiting = lifecycle.pending > 0;
	const fullyLinked =
		lifecycle.total > 0 &&
		lifecycle.complete === lifecycle.total &&
		linkage.matchedLedgerCount === linkage.expectedLedgerCount;
	const inconsistent = !empty && !failed && !active && !waiting && !fullyLinked;
	return (
		<StatusRow
			detail={
				empty
					? 'No LedgerCloseMeta batch overlaps proof-gated canonical history yet.'
					: `Compares decoded ledger headers and hashes with proof-gated canonical ledgers. Last recorded: ${formatInteger(lifecycle.checking)} checking, ${formatInteger(lifecycle.pending)} queued, ${formatInteger(lifecycle.failed)} failed. Updated ${formatNullableDate(linkage.latestUpdatedAt, formatDateTime)}; not live worker status. This does not verify account/trustline contents or SCP signatures.`
			}
			label="Canonical ledger linkage (recorded)"
			pillText={
				empty
					? 'Awaiting overlap'
					: failed
						? 'Needs attention'
						: active
							? 'Recorded checking'
							: waiting
								? 'Queued'
								: inconsistent
									? 'Inconsistent'
									: 'Linked'
			}
			status={failed || inconsistent ? 'degraded' : 'ok'}
			tone={progressTone(empty, failed || inconsistent, active || waiting)}
			value={
				empty
					? 'Awaiting overlapping proof range'
					: `${formatUnsigned(linkage.matchedLedgerCount)} / ${formatUnsigned(linkage.expectedLedgerCount)} LCM ledgers matched`
			}
		/>
	);
}

function progressTone(
	empty: boolean,
	failed: boolean,
	inProgress: boolean
): StatusPillTone {
	if (failed) return 'warning';
	if (empty || inProgress) return 'neutral';
	return 'good';
}

function formatNullableDate(
	value: string | null,
	formatDateTime: (value: string) => string
): string {
	return value === null ? 'not reported' : formatDateTime(value);
}

function formatUnsigned(value: string): string {
	return BigInt(value).toLocaleString('en-US');
}
