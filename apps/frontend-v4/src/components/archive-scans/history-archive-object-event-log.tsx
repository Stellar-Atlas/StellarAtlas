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

const MAX_ARCHIVE_EVENT_ROWS = 80;

export function HistoryArchiveObjectEventLog({
	events,
	framed = true,
	title = 'Recent archive file activity'
}: HistoryArchiveObjectEventLogProps): React.JSX.Element {
	const failedEvents = events.events.filter(
		(event) => event.eventType === 'failed'
	);
	const recentEvents = events.events.slice(0, MAX_ARCHIVE_EVENT_ROWS);
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
			<EventFailureTable events={failedEvents} />
			<EventHistoryDetails
				events={recentEvents}
				totalEvents={events.events.length}
			/>
		</>
	);

	if (!framed) return <div className="archive-object-events">{content}</div>;

	return (
		<section className="panel detail-panel archive-panel">{content}</section>
	);
}

function EventFailureTable({
	events
}: {
	readonly events: readonly ObjectEvents['events'][number][];
}): React.JSX.Element {
	if (events.length === 0) {
		return (
			<p className="archive-good-state">
				No failed archive file activity is in the recent event window.
			</p>
		);
	}

	return (
		<div className="archive-priority-block">
			<div className="archive-table-caption">
				<strong>Failed archive activity</strong>
				<span>{formatInteger(events.length)} shown</span>
			</div>
			<EventTable events={events} />
		</div>
	);
}

function EventHistoryDetails({
	events,
	totalEvents
}: {
	readonly events: readonly ObjectEvents['events'][number][];
	readonly totalEvents: number;
}): React.JSX.Element {
	if (totalEvents === 0) {
		return (
			<p className="muted-copy">No archive file activity is available yet.</p>
		);
	}

	return (
		<details className="metadata-document archive-object-details">
			<summary>
				<span>Recent file activity</span>
				<span className="muted-inline">
					Showing {formatInteger(events.length)} of {formatInteger(totalEvents)}
				</span>
			</summary>
			<EventTable events={events} />
		</details>
	);
}

function EventTable({
	events
}: {
	readonly events: readonly ObjectEvents['events'][number][];
}): React.JSX.Element {
	return (
		<div className="responsive-table">
			<table className="archive-object-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>File type</th>
						<th>Archive</th>
						<th>File</th>
						<th>Activity</th>
					</tr>
				</thead>
				<tbody>
					{events.map((event) => (
						<EventRow event={event} key={event.remoteId} />
					))}
				</tbody>
			</table>
		</div>
	);
}

function EventRow({
	event
}: {
	readonly event: ObjectEvents['events'][number];
}): React.JSX.Element {
	return (
		<tr>
			<td>
				<StatusPill
					status={mapEventStatus(event.eventType)}
					text={formatEventType(event.eventType)}
				/>
			</td>
			<td>
				<strong>{formatObjectType(event.objectType)}</strong>
				{event.checkpointLedger === null ? null : (
					<small>{formatEventLedger(event.checkpointLedger)}</small>
				)}
			</td>
			<td>{formatArchiveSource(event.archiveUrl)}</td>
			<td>
				<span className="archive-object-url">{event.objectKey}</span>
				{event.error ? (
					<small className="archive-object-error">
						{event.error.type}: {event.error.message}
					</small>
				) : null}
			</td>
			<td>
				<strong>{event.workerStage ?? formatEventType(event.eventType)}</strong>
				<small>{formatEventWork(event)}</small>
			</td>
		</tr>
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
	if (type === 'history-archive-state') return 'history archive state file';
	if (type === 'checkpoint-state') return 'checkpoint history file';
	if (type === 'ledger') return 'ledger file';
	if (type === 'transactions') return 'transaction archive file';
	if (type === 'results') return 'result archive file';
	if (type === 'scp') return 'SCP archive file';
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
