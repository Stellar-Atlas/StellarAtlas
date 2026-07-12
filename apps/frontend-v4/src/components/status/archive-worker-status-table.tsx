import type {
	ArchiveWorkerOutcomeDTO,
	ArchiveWorkerStatusRowDTO,
	PublicWorkerStatus
} from '@api/types';
import { formatArchiveObjectTypeLabel } from '@domain/history-archive';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill } from './status-ui';

export function ArchiveWorkerStatusTable({
	workers
}: {
	readonly workers: PublicWorkerStatus;
}): React.JSX.Element {
	const archive = workers.archiveWorkers;
	const aggregateOnly = archive.telemetryMode === 'aggregate-only';
	return (
		<section className="panel detail-panel status-worker-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive workers</h2>
					<span className="muted-inline">
						{aggregateOnly
							? `${formatInteger(archive.activeWorkers)} / ${formatInteger(archive.configuredWorkerProcesses)} active (aggregate telemetry)`
							: `${formatInteger(archive.freshWorkers)} / ${formatInteger(archive.configuredWorkerProcesses)} fresh${archive.startupGraceActive ? ' during startup' : ''}`}
					</span>
				</div>
				<StatusPill status={archive.status} />
			</div>
			<div className="responsive-table status-worker-table-wrap">
				<table className="status-worker-table">
					<thead>
						<tr>
							<th>Worker / process</th>
							<th>Current file</th>
							<th>Stage</th>
							<th>Progress</th>
							<th>Heartbeat</th>
							<th>Last outcome</th>
						</tr>
					</thead>
					<tbody>
						{archive.workers.length > 0 ? (
							archive.workers.map((worker) => (
								<ArchiveWorkerRow key={worker.workerId} worker={worker} />
							))
						) : (
							<tr>
								<td colSpan={6}>
									{aggregateOnly
										? 'Per-worker telemetry is unavailable during mixed rollout.'
										: 'No recent worker registrations.'}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function ArchiveWorkerRow({
	worker
}: {
	readonly worker: ArchiveWorkerStatusRowDTO;
}): React.JSX.Element {
	return (
		<tr>
			<td>
				<strong>{worker.workerId}</strong>
				<small>
					PID {formatInteger(worker.pid)} / {shortIdentity(worker.processId)} /
					gen {formatInteger(worker.processGeneration)}
				</small>
			</td>
			<td>{formatCurrentObject(worker)}</td>
			<td>
				<span className={`status-worker-state ${worker.status}`}>
					{worker.status}
				</span>
				<small>{formatStage(worker.stage)}</small>
			</td>
			<td>
				{worker.bytesDownloaded === null
					? 'No byte count'
					: formatBytes(worker.bytesDownloaded)}
				<small>
					{worker.claimAttempt === null
						? 'No active claim'
						: `Attempt ${formatInteger(worker.claimAttempt)}`}
				</small>
			</td>
			<td>
				{formatAge(worker.heartbeatAgeMs)} ago
				<small>{formatDateTime(worker.lastHeartbeatAt)}</small>
			</td>
			<td>
				{formatOutcome(worker.lastOutcome)}
				<small>
					{worker.lastOutcomeAt === null
						? 'No completed outcome'
						: formatDateTime(worker.lastOutcomeAt)}
				</small>
			</td>
		</tr>
	);
}

function formatCurrentObject(
	worker: ArchiveWorkerStatusRowDTO
): React.JSX.Element | string {
	const object = worker.currentObject;
	if (object === null) return 'Idle';
	return (
		<>
			<strong>{formatArchiveObjectTypeLabel(object.type)}</strong>
			<small className="status-worker-remote-id" title={object.remoteId}>
				{object.remoteId}
			</small>
			<small>{formatArchiveHost(object.source)}</small>
		</>
	);
}

function formatArchiveHost(source: string): string {
	try {
		const url = new URL(source);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return 'Archive source';
		}
		return url.host;
	} catch {
		return 'Archive source';
	}
}

function shortIdentity(value: string): string {
	return `proc ${value.slice(0, 8)}`;
}

function formatStage(stage: ArchiveWorkerStatusRowDTO['stage']): string {
	return stage.replaceAll('_', ' ');
}

function formatOutcome(outcome: ArchiveWorkerOutcomeDTO): string {
	return outcome === 'none' ? 'None' : outcome.replaceAll('_', ' ');
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${formatInteger(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function formatAge(ageMs: number): string {
	if (ageMs < 1000) return '<1s';
	if (ageMs < 60_000) return `${Math.floor(ageMs / 1000).toString()}s`;
	return `${Math.floor(ageMs / 60_000).toString()}m`;
}
