import type {
	PublicFullHistoryCanonicalStateLinkageStatus,
	PublicFullHistoryStateImportStatus,
	PublicFullHistoryStatus
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusRow, type StatusPillTone } from './status-ui';

export function LedgerCloseMetaStateStatusRows({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element {
	const state = fullHistory.ledgerCloseMetaState;
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
					: `${formatInteger(lifecycle.importing)} importing, ${formatInteger(lifecycle.pending)} queued, ${formatInteger(lifecycle.failed)} failed; latest update ${formatNullableDate(imports.latestUpdatedAt)}`
			}
			label="Account and trustline state"
			pillText={
				empty
					? 'Awaiting data'
					: failed
						? 'Needs attention'
						: active
							? 'Importing'
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
					? 'No imported state batch overlaps proof-v6 canonical history yet.'
					: `Imported account and trustline rows are prerequisites. The check compares the LedgerCloseMeta ledger header and hash projection with proof-v6 canonical ledgers: ${formatInteger(lifecycle.checking)} checking, ${formatInteger(lifecycle.pending)} queued, ${formatInteger(lifecycle.failed)} failed; latest update ${formatNullableDate(linkage.latestUpdatedAt)}. It does not compare account or trustline contents with a canonical state snapshot and is not SCP evidence.`
			}
			label="Canonical ledger linkage"
			pillText={
				empty
					? 'Awaiting overlap'
					: failed
						? 'Needs attention'
						: active
							? 'Checking'
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

function formatNullableDate(value: string | null): string {
	return value === null ? 'not reported' : formatDateTime(value);
}

function formatUnsigned(value: string): string {
	return BigInt(value).toLocaleString('en-US');
}
