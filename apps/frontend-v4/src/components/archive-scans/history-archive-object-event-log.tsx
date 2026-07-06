import type {
	PublicHistoryArchiveObjectEvents as ObjectEvents,
	PublicStatusLevel
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import { formatDateTime, formatInteger } from '@format/formatters';

interface HistoryArchiveObjectEventLogProps {
	readonly events: ObjectEvents;
	readonly framed?: boolean;
	readonly title?: string;
}

export function HistoryArchiveObjectEventLog({
	events,
	framed = true,
	title = 'Recent archive file activity'
}: HistoryArchiveObjectEventLogProps): React.JSX.Element {
	const content = (
		<>
			<div className="panel-heading">
				<div>
					<h2>{title}</h2>
					<span className="muted-inline">
						Updated {formatDateTime(events.generatedAt)}
					</span>
				</div>
				<StatusPill
					status={
						events.events.some((event) => event.eventType === 'failed')
							? 'degraded'
							: 'ok'
					}
					text={`${formatInteger(events.count)} events`}
				/>
			</div>
			{events.events.length === 0 ? (
				<p className="muted-copy">No archive file activity is available yet.</p>
			) : (
				<div className="table archive-object-table">
					{events.events.map((event) => (
						<EventRow event={event} key={event.remoteId} />
					))}
				</div>
			)}
		</>
	);

	if (!framed) return <div className="archive-object-events">{content}</div>;

	return (
		<section className="panel detail-panel archive-panel">{content}</section>
	);
}

function EventRow({
	event
}: {
	readonly event: ObjectEvents['events'][number];
}): React.JSX.Element {
	return (
		<div className="row archive-object-row">
			<div className="archive-object-main">
				<div className="archive-object-title">
					<StatusPill
						status={mapEventStatus(event.eventType)}
						text={formatEventType(event.eventType)}
					/>
					<strong>{formatObjectType(event.objectType)}</strong>
					<span>{formatEventLedger(event.checkpointLedger)}</span>
				</div>
				<small className="archive-object-source">
					Source: {formatArchiveSource(event.archiveUrl)}
				</small>
				<small className="archive-object-url">File: {event.objectKey}</small>
				{event.error ? (
					<small className="archive-object-error">
						{event.error.type}: {event.error.message}
					</small>
				) : null}
			</div>
			<div className="metric archive-object-metric">
				<strong>{event.workerStage ?? formatEventType(event.eventType)}</strong>
				<small>{formatEventWork(event)}</small>
			</div>
		</div>
	);
}

function mapEventStatus(
	eventType: ObjectEvents['events'][number]['eventType']
): PublicStatusLevel {
	if (eventType === 'failed') return 'degraded';
	return 'ok';
}

function formatEventType(
	eventType: ObjectEvents['events'][number]['eventType']
): string {
	if (eventType === 'heartbeat') return 'heartbeat';
	if (eventType === 'verified') return 'verified';
	if (eventType === 'failed') return 'failed';
	if (eventType === 'released') return 'released';
	return 'claimed';
}

function formatObjectType(
	type: ObjectEvents['events'][number]['objectType']
): string {
	if (type === 'history-archive-state') return 'root state file';
	if (type === 'checkpoint-state') return 'checkpoint state file';
	if (type === 'ledger') return 'ledger file';
	if (type === 'transactions') return 'transaction category file';
	if (type === 'results') return 'result category file';
	if (type === 'scp') return 'SCP category file';
	if (type === 'bucket') return 'bucket file';
	return type;
}

function formatEventLedger(value: number | null): string {
	return value === null ? '' : `checkpoint ${formatInteger(value)}`;
}

function formatArchiveSource(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return `${url.host}${path}`;
	} catch {
		return value;
	}
}

function formatEventWork(event: ObjectEvents['events'][number]): string {
	const parts = [
		`attempt ${event.claimAttempt === null ? 'n/a' : formatInteger(event.claimAttempt)}`,
		event.bytesDownloaded === null ? null : formatBytes(event.bytesDownloaded),
		event.evidenceClass,
		event.nextAttemptAt ? `retry ${formatDateTime(event.nextAttemptAt)}` : null,
		`at ${formatDateTime(event.createdAt)}`
	].filter((part): part is string => part !== null && part.length > 0);

	return parts.join(' / ');
}

function formatBytes(value: number): string {
	if (value < 1024) return `${formatInteger(value)} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let amount = value / 1024;
	for (const unit of units) {
		if (amount < 1024) return `${amount.toFixed(amount < 10 ? 1 : 0)} ${unit}`;
		amount /= 1024;
	}

	return `${amount.toFixed(1)} PB`;
}
