'use client';

import { useSyncExternalStore } from 'react';

const subscribeToHydration = (): (() => void) => () => {};
const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;

interface LocalDateTimeProps {
	readonly dateTime: string;
}

export function LocalDateTime({
	dateTime
}: LocalDateTimeProps): React.JSX.Element {
	const hydrated = useSyncExternalStore(
		subscribeToHydration,
		clientSnapshot,
		serverSnapshot
	);
	const date = new Date(dateTime);
	if (!Number.isFinite(date.getTime())) return <span>Time unavailable</span>;
	const iso = date.toISOString();

	return (
		<time dateTime={iso} title={iso}>
			{hydrated
				? formatLocalDateTime(date)
				: `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}
		</time>
	);
}

export function formatLocalDateTime(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	}).format(date);
}

export function useLocalDateTimeFormatter(): (value: string) => string {
	const hydrated = useSyncExternalStore(
		subscribeToHydration,
		clientSnapshot,
		serverSnapshot
	);
	return hydrated ? formatLocalTimestamp : formatServerTimestamp;
}

function formatLocalTimestamp(value: string): string {
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? formatLocalDateTime(date)
		: 'Time unavailable';
}

function formatServerTimestamp(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return 'Time unavailable';
	const iso = date.toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
