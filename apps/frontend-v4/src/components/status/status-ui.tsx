import type { PublicStatusLevel } from '@api/types';
import {
	archiveHealthLabel,
	archiveHealthTone,
	type ArchiveHealthState
} from '@domain/history-archive-health';

export function ArchiveHealthRow({
	detail,
	label,
	state,
	value
}: {
	readonly detail: string;
	readonly label: string;
	readonly state: ArchiveHealthState;
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
				<ArchiveHealthPill state={state} />
			</div>
		</div>
	);
}

export function ArchiveHealthPill({
	state,
	text
}: {
	readonly state: ArchiveHealthState;
	readonly text?: string;
}): React.JSX.Element {
	return (
		<span className={`status-pill ${archiveHealthTone(state)}`}>
			{text ?? archiveHealthLabel(state)}
		</span>
	);
}

export function StatusRow({
	detail,
	label,
	pillText,
	status,
	value
}: {
	readonly detail: string;
	readonly label: string;
	readonly pillText?: string;
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
				<StatusPill status={status} text={pillText} />
			</div>
		</div>
	);
}

export function StatusPill({
	status,
	text
}: {
	readonly status: PublicStatusLevel;
	readonly text?: string;
}): React.JSX.Element {
	return (
		<span className={`status-pill ${statusTone(status)}`}>
			{text ?? statusLabel(status)}
		</span>
	);
}

export function statusTone(
	status: PublicStatusLevel
): 'good' | 'warning' | 'danger' {
	if (status === 'ok') return 'good';
	if (status === 'degraded') return 'warning';
	return 'danger';
}

export function statusLabel(status: PublicStatusLevel): string {
	if (status === 'ok') return 'OK';
	if (status === 'degraded') return 'Degraded';
	return 'Unavailable';
}
