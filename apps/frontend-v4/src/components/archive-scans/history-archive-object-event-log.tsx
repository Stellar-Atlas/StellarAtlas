'use client';

import { useMemo, useState } from 'react';
import type {
	PublicHistoryArchiveObjectEvents as ObjectEvents,
	PublicStatusLevel
} from '@api/types';
import { StatusPill } from '@components/status/status-ui';
import {
	formatArchiveErrorTypeLabel,
	formatArchiveObjectTypeLabel,
	formatArchiveObjectStatusLabel,
	formatArchiveWorkerStageLabel,
	sanitizeArchiveEvidenceText
} from '@domain/history-archive';
import { formatDateTime, formatInteger } from '@format/formatters';

interface HistoryArchiveObjectEventLogProps {
	readonly events: ObjectEvents;
	readonly framed?: boolean;
	readonly title?: string;
}

const MAX_ARCHIVE_EVENT_ROWS = 80;
const EVENT_FILTERS = [
	'all',
	'download',
	'check',
	'parse',
	'verified',
	'failed'
] as const;

type EventFilter = (typeof EVENT_FILTERS)[number];

export function HistoryArchiveObjectEventLog({
	events,
	framed = true,
	title = 'Recent archive file activity'
}: HistoryArchiveObjectEventLogProps): React.JSX.Element {
	const [filter, setFilter] = useState<EventFilter>('all');
	const failedEvents = events.events.filter(
		(event) => event.eventType === 'failed'
	);
	const filteredEvents = useMemo(
		() => filterEvents(events.events, filter).slice(0, MAX_ARCHIVE_EVENT_ROWS),
		[events.events, filter]
	);
	const filterCounts = useMemo(
		() => countEventFilters(events.events),
		[events.events]
	);
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
					status={failedEvents.length > 0 ? 'degraded' : 'ok'}
					text={formatEventStatusText(events.count, failedEvents.length)}
				/>
			</div>
			<EventFailureTable events={failedEvents} />
			<EventFilterTabs
				activeFilter={filter}
				counts={filterCounts}
				onChange={setFilter}
			/>
			<EventHistoryDetails
				activeFilter={filter}
				events={filteredEvents}
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
				No failed archive file checks are in the recent event window.
			</p>
		);
	}

	return (
		<div className="archive-priority-block">
			<div className="archive-table-caption">
				<strong>Failed archive file evidence</strong>
				<span>{formatInteger(events.length)} shown</span>
			</div>
			<EventTable events={events} />
		</div>
	);
}

function EventHistoryDetails({
	activeFilter,
	events,
	totalEvents
}: {
	readonly activeFilter: EventFilter;
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
				<span>{formatFilterTitle(activeFilter)} activity</span>
				<span className="muted-inline">
					Showing {formatInteger(events.length)} of {formatInteger(totalEvents)}
				</span>
			</summary>
			<EventTable events={events} />
		</details>
	);
}

function EventFilterTabs({
	activeFilter,
	counts,
	onChange
}: {
	readonly activeFilter: EventFilter;
	readonly counts: Readonly<Record<EventFilter, number>>;
	readonly onChange: (filter: EventFilter) => void;
}): React.JSX.Element {
	return (
		<div className="segmented" aria-label="Archive activity filter">
			{EVENT_FILTERS.map((filter) => (
				<button
					className={filter === activeFilter ? 'active' : undefined}
					key={filter}
					onClick={() => onChange(filter)}
					type="button"
				>
					{formatFilterTitle(filter)} {formatInteger(counts[filter])}
				</button>
			))}
		</div>
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
						<th>Event</th>
						<th>Archive file</th>
						<th>Archive source</th>
						<th>File id</th>
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
				<strong>{formatArchiveObjectTypeLabel(event.objectType)}</strong>
				{event.checkpointLedger === null ? null : (
					<small>{formatEventLedger(event.checkpointLedger)}</small>
				)}
			</td>
			<td>{formatArchiveSource(event.archiveUrl)}</td>
			<td>
				<span className="archive-object-url">{event.objectKey}</span>
				{event.error ? (
					<small className="archive-object-error">
						{formatArchiveErrorTypeLabel(event.error.type)}:{' '}
						{sanitizeArchiveEvidenceText(event.error.message)}
					</small>
				) : null}
			</td>
			<td>
				<strong>{formatEventStage(event)}</strong>
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
	return formatArchiveObjectStatusLabel(eventType);
}

function formatEventStage(event: ObjectEvents['events'][number]): string {
	return (
		formatArchiveWorkerStageLabel(event.workerStage) ||
		formatArchiveObjectStatusLabel(event.eventType)
	);
}

function formatEventStatusText(
	totalEvents: number,
	failedEvents: number
): string {
	if (failedEvents > 0) {
		return formatInteger(failedEvents) + ' failures';
	}

	return totalEvents > 0 ? '0 recent failures' : 'no recent events';
}

function filterEvents(
	events: readonly ObjectEvents['events'][number][],
	filter: EventFilter
): readonly ObjectEvents['events'][number][] {
	if (filter === 'all') return events;
	return events.filter((event) => eventMatchesFilter(event, filter));
}

function countEventFilters(
	events: readonly ObjectEvents['events'][number][]
): Readonly<Record<EventFilter, number>> {
	return {
		all: events.length,
		check: events.filter((event) => eventMatchesFilter(event, 'check')).length,
		download: events.filter((event) => eventMatchesFilter(event, 'download'))
			.length,
		failed: events.filter((event) => eventMatchesFilter(event, 'failed')).length,
		parse: events.filter((event) => eventMatchesFilter(event, 'parse')).length,
		verified: events.filter((event) => eventMatchesFilter(event, 'verified'))
			.length
	};
}

function eventMatchesFilter(
	event: ObjectEvents['events'][number],
	filter: Exclude<EventFilter, 'all'>
): boolean {
	if (filter === 'failed') return event.eventType === 'failed';
	if (filter === 'verified') return event.eventType === 'verified';
	const stage = event.workerStage ?? '';
	if (filter === 'download') return stage.includes('download');
	if (filter === 'parse') return stage.includes('parse');
	return (
		event.eventType === 'claimed' ||
		event.eventType === 'heartbeat' ||
		stage.includes('claim') ||
		stage.includes('verify') ||
		stage.includes('hash')
	);
}

function formatFilterTitle(filter: EventFilter): string {
	if (filter === 'all') return 'All';
	if (filter === 'download') return 'Download';
	if (filter === 'check') return 'Check';
	if (filter === 'parse') return 'Parse';
	if (filter === 'verified') return 'Verified';
	return 'Failed';
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
