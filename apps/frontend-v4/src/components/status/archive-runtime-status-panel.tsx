import {
	archiveHealthLabel,
	type ArchiveHealthState
} from '@domain/history-archive-health';
import { archiveRuntimeTone } from './status-dashboard-headlines';
import { StatusPill, StatusRow } from './status-ui';

export function ArchiveRuntimeStatusPanel({
	checkedAt,
	detail,
	state,
	value
}: {
	readonly checkedAt: string;
	readonly detail: string;
	readonly state: ArchiveHealthState;
	readonly value: string;
}): React.JSX.Element {
	const tone = archiveRuntimeTone(state) ?? 'neutral';
	const status =
		tone === 'good' ? 'ok' : tone === 'warning' ? 'degraded' : 'unavailable';
	const label = state === 'verified' ? 'Idle' : archiveHealthLabel(state);
	return (
		<section className="panel" aria-label="Archive verification runtime">
			<div className="panel-heading">
				<div>
					<strong>Archive verification runtime</strong>
					<span>{checkedAt}; runtime health, not archive integrity</span>
				</div>
				<StatusPill status={status} text={label} tone={tone} />
			</div>
			<div className="status-list">
				<StatusRow
					detail={detail}
					label="Current checks"
					pillText={label}
					status={status}
					tone={tone}
					value={value}
				/>
			</div>
		</section>
	);
}
