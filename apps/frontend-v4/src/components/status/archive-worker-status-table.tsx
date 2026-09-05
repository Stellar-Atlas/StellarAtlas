'use client';

import { historyArchiveWorkerTelemetryLimit } from 'history-scanner-dto';
import type {
	ArchiveWorkerOutcomeDTO,
	ArchiveWorkerStatusRowDTO,
	PublicWorkerStatus
} from '@api/types';
import { formatArchiveObjectTypeLabel } from '@domain/history-archive';
import { formatInteger } from '@format/formatters';
import { useLocalDateTimeFormatter } from '../local-date-time';
import { getArchiveDownloadActivity } from './archive-download-activity';
import { StatusPill } from './status-ui';

const MAX_ARCHIVE_WORKER_SLOTS = historyArchiveWorkerTelemetryLimit;
const MAX_RENDERED_ARCHIVE_WORKER_ROWS = 48;

type ArchiveWorkerSlot = {
	readonly slotIndex: number;
	readonly worker: ArchiveWorkerStatusRowDTO | null;
};

export function ArchiveWorkerStatusTable({
	workers
}: {
	readonly workers: PublicWorkerStatus;
}): React.JSX.Element {
	const archive = workers.archiveWorkers;
	const aggregateOnly = archive.telemetryMode === 'aggregate-only';
	const allWorkerSlots = createWorkerSlots(
		archive.workers,
		archive.configuredWorkerProcesses
	);
	const workerSlots = selectWorkerSlots(allWorkerSlots);
	const hiddenWorkerSlotCount = allWorkerSlots.length - workerSlots.length;
	const downloadActivity = getArchiveDownloadActivity(archive.workers);
	return (
		<section className="panel detail-panel status-worker-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive workers</h2>
					<span className="muted-inline">
						{aggregateOnly
							? `${formatInteger(archive.activeWorkers)} / ${formatInteger(archive.configuredWorkerProcesses)} active (aggregate telemetry)`
							: `${formatInteger(archive.freshWorkers)} / ${formatInteger(archive.configuredWorkerProcesses)} fresh; ${formatInteger(downloadActivity.activeDownloads)} downloading; ${formatInteger(downloadActivity.waitingForDownloadSlots)} waiting for a slot${archive.startupGraceActive ? ' during startup' : ''}`}
					</span>
					{!aggregateOnly && hiddenWorkerSlotCount > 0 ? (
						<span className="muted-inline">
							Showing {formatInteger(workerSlots.length)} of{' '}
							{formatInteger(allWorkerSlots.length)} worker slots; active and
							unhealthy slots first.
						</span>
					) : null}
				</div>
				<StatusPill status={archive.status} />
			</div>
			<div className="responsive-table status-worker-table-wrap">
				<table className="status-worker-table">
					<thead>
						<tr>
							<th>Slot / process</th>
							<th>Current file</th>
							<th>Stage</th>
							<th>Progress</th>
							<th>Heartbeat</th>
							<th>Last outcome</th>
						</tr>
					</thead>
					<tbody>
						{!aggregateOnly && workerSlots.length > 0 ? (
							workerSlots.map(({ slotIndex, worker }) =>
								worker === null ? (
									<MissingArchiveWorkerRow
										key={slotIndex}
										slotIndex={slotIndex}
									/>
								) : (
									<ArchiveWorkerRow key={slotIndex} worker={worker} />
								)
							)
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

function createWorkerSlots(
	workers: readonly ArchiveWorkerStatusRowDTO[],
	configuredWorkerProcesses: number
): readonly ArchiveWorkerSlot[] {
	const configuredSlots = Math.min(
		MAX_ARCHIVE_WORKER_SLOTS,
		Math.max(0, configuredWorkerProcesses)
	);
	const workersBySlot = new Map<number, ArchiveWorkerStatusRowDTO>();
	for (const worker of workers) {
		if (
			worker.slotIndex < configuredSlots &&
			!workersBySlot.has(worker.slotIndex)
		) {
			workersBySlot.set(worker.slotIndex, worker);
		}
	}
	return Array.from({ length: configuredSlots }, (_, slotIndex) => ({
		slotIndex,
		worker: workersBySlot.get(slotIndex) ?? null
	}));
}

function selectWorkerSlots(
	workerSlots: readonly ArchiveWorkerSlot[]
): readonly ArchiveWorkerSlot[] {
	if (workerSlots.length <= MAX_RENDERED_ARCHIVE_WORKER_ROWS) {
		return workerSlots;
	}
	return [...workerSlots]
		.sort(
			(left, right) =>
				workerSlotPriority(left) - workerSlotPriority(right) ||
				left.slotIndex - right.slotIndex
		)
		.slice(0, MAX_RENDERED_ARCHIVE_WORKER_ROWS)
		.sort((left, right) => left.slotIndex - right.slotIndex);
}

function workerSlotPriority(slot: ArchiveWorkerSlot): number {
	const worker = slot.worker;
	if (worker === null) return 2;
	if (
		worker.status === 'stale' ||
		worker.lastOutcome === 'archive_error' ||
		worker.lastOutcome === 'worker_issue'
	) {
		return 0;
	}
	if (worker.status === 'active' || worker.currentObject !== null) return 1;
	return 3;
}
function MissingArchiveWorkerRow({
	slotIndex
}: {
	readonly slotIndex: number;
}): React.JSX.Element {
	return (
		<tr className="status-worker-missing">
			<td>
				<strong>Slot {formatInteger(slotIndex)}</strong>
			</td>
			<td colSpan={5}>No recent worker registration.</td>
		</tr>
	);
}

function ArchiveWorkerRow({
	worker
}: {
	readonly worker: ArchiveWorkerStatusRowDTO;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	return (
		<tr>
			<td>
				<strong>Slot {formatInteger(worker.slotIndex)}</strong>
				<small>{worker.workerId}</small>
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
				<ArchiveWorkerProgress worker={worker} />
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

function ArchiveWorkerProgress({
	worker
}: {
	readonly worker: ArchiveWorkerStatusRowDTO;
}): React.JSX.Element {
	const attempt =
		worker.claimAttempt === null
			? 'No active claim'
			: `Attempt ${formatInteger(worker.claimAttempt)}`;
	if (worker.currentObject === null) {
		return (
			<>
				No active transfer
				<small>{attempt}</small>
			</>
		);
	}
	if (worker.stage === 'waiting_for_download_slot') {
		return (
			<>
				Waiting for download slot
				<small>{attempt}</small>
			</>
		);
	}

	const downloaded = worker.bytesDownloaded ?? 0;
	const label = `Transfer progress for slot ${formatInteger(worker.slotIndex)}`;
	if (worker.bytesTotal === null) {
		return (
			<div className="status-worker-progress">
				<progress aria-label={label} />
				<span>
					{worker.bytesDownloaded === null
						? 'Waiting for bytes'
						: `${formatBytes(worker.bytesDownloaded)} transferred`}
				</span>
				<small>{attempt}</small>
			</div>
		);
	}

	const progressMax = Math.max(worker.bytesTotal, 1);
	const progressValue = Math.min(downloaded, worker.bytesTotal);
	return (
		<div className="status-worker-progress">
			<progress aria-label={label} max={progressMax} value={progressValue} />
			<span>
				{formatBytes(downloaded)} / {formatBytes(worker.bytesTotal)}
			</span>
			<small>{attempt}</small>
		</div>
	);
}

function formatCurrentObject(
	worker: ArchiveWorkerStatusRowDTO
): React.JSX.Element | string {
	const object = worker.currentObject;
	if (object === null) {
		return worker.stage === 'waiting_for_download_slot'
			? 'Waiting for network capacity'
			: 'Idle';
	}
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
