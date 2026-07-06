import type {
	PublicArchiveScanWorker,
	PublicArchiveScanWorkers,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill } from './status-ui';

interface ArchiveWorkerJobsProps {
	readonly archiveWorkers: PublicArchiveScanWorkers;
}

export function ArchiveWorkerJobs({
	archiveWorkers
}: ArchiveWorkerJobsProps): React.JSX.Element {
	const workers = [...archiveWorkers.workers].sort(compareWorkers);
	const hiddenWorkers = Math.max(
		0,
		archiveWorkers.totalTakenJobs - workers.length
	);
	const runningWorkers = workers.filter(isRunningWorker).length;
	const startingWorkers = workers.filter(isStartingWorker).length;

	return (
		<section className="panel status-current-jobs-panel">
			<div className="panel-heading">
				<div>
					<strong>Current Archive Jobs</strong>
					<span>{formatDateTime(archiveWorkers.generatedAt)}</span>
				</div>
				<span className="status-muted">
					{formatInteger(runningWorkers)} scanning,
					{` ${formatInteger(startingWorkers)} starting,`}
					{` ${formatInteger(archiveWorkers.staleWorkers)} stale`}
				</span>
			</div>
			<div className="status-current-jobs">
				{workers.length === 0 ? (
					<div className="status-current-empty">
						<strong>No current archive jobs</strong>
						<small>Workers have no fresh or stale taken jobs right now.</small>
					</div>
				) : (
					workers.map((worker, index) => (
						<ArchiveWorkerJobRow
							id={getWorkerFragmentId(worker, index)}
							key={`${worker.archiveUrl}-${worker.claimedAt}-${worker.fromLedger}-${index}`}
							worker={worker}
						/>
					))
				)}
				{hiddenWorkers > 0 && (
					<div className="status-current-empty">
						<strong>
							{formatInteger(hiddenWorkers)} more jobs beyond this snapshot
						</strong>
						<small>
							The worker endpoint returned {formatInteger(workers.length)} of{' '}
							{formatInteger(archiveWorkers.totalTakenJobs)} claimed jobs.
						</small>
					</div>
				)}
			</div>
		</section>
	);
}

function ArchiveWorkerJobRow({
	id,
	worker
}: {
	readonly id: string;
	readonly worker: PublicArchiveScanWorker;
}): React.JSX.Element {
	const displayStatus = getDisplayStatus(worker);
	const status: PublicStatusLevel =
		displayStatus === 'scanning' ? 'ok' : 'degraded';
	const concurrencyLabel =
		displayStatus === 'scanning'
			? `${formatInteger(worker.concurrency ?? 0)} workers`
			: displayStatus;

	return (
		<details className="metadata-document" id={id} open={status !== 'ok'}>
			<summary>
				<span>{formatArchiveUrl(worker.archiveUrl)}</span>
				<span>
					<StatusPill status={status} text={displayStatus} />
				</span>
			</summary>
			<dl className="details">
				<div>
					<dt>Range</dt>
					<dd>{formatLedgerRange(worker)}</dd>
				</div>
				<div>
					<dt>Latest scanned</dt>
					<dd>{formatInteger(worker.latestScannedLedger)}</dd>
				</div>
				<div>
					<dt>Concurrency</dt>
					<dd>{concurrencyLabel}</dd>
				</div>
				<div>
					<dt>Claimed</dt>
					<dd>{formatDateTime(worker.claimedAt)}</dd>
				</div>
				<div>
					<dt>Last heartbeat</dt>
					<dd>{formatDateTime(worker.lastHeartbeatAt)}</dd>
				</div>
				<div>
					<dt>Heartbeat age</dt>
					<dd>{formatDuration(worker.heartbeatAgeMs)}</dd>
				</div>
			</dl>
		</details>
	);
}

function formatArchiveUrl(value: string): string {
	if (looksLikeInternalPath(value)) return 'Internal scanner target';
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return url.hostname;
		}
		return 'Internal scanner target';
	} catch {
		return sanitizeEvidenceText(value);
	}
}

function formatLedgerRange(worker: PublicArchiveScanWorker): string {
	const end =
		worker.toLedger === null ? 'latest' : formatInteger(worker.toLedger);
	return `${formatInteger(worker.fromLedger)}-${end}`;
}

function formatDuration(value: number): string {
	const minutes = Math.round(value / 60000);
	if (minutes < 1) return '<1 min';
	if (minutes < 60) return `${formatInteger(minutes)} min`;
	return `${formatInteger(Math.round(minutes / 60))} hr`;
}

function compareWorkers(
	left: PublicArchiveScanWorker,
	right: PublicArchiveScanWorker
): number {
	const statusDifference = workerRank(left) - workerRank(right);
	if (statusDifference !== 0) return statusDifference;

	return Date.parse(right.lastHeartbeatAt) - Date.parse(left.lastHeartbeatAt);
}

function workerRank(worker: PublicArchiveScanWorker): number {
	const status = getDisplayStatus(worker);
	if (status === 'scanning') return 0;
	if (status === 'starting') return 1;
	return 2;
}

function getDisplayStatus(
	worker: PublicArchiveScanWorker
): 'scanning' | 'starting' | 'stale' {
	return worker.status;
}

function isRunningWorker(worker: PublicArchiveScanWorker): boolean {
	return getDisplayStatus(worker) === 'scanning';
}

function isStartingWorker(worker: PublicArchiveScanWorker): boolean {
	return getDisplayStatus(worker) === 'starting';
}

function getWorkerFragmentId(
	worker: PublicArchiveScanWorker,
	index: number
): string {
	return `archive-job-${index}-${hashText(
		`${worker.archiveUrl}:${worker.fromLedger}:${worker.toLedger ?? 'latest'}:${worker.claimedAt}`
	)}`;
}

function hashText(value: string): string {
	let hash = 0;
	for (const character of value) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return hash.toString(36);
}

function sanitizeEvidenceText(value: string): string {
	return value.replace(
		/(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\/[^\s'"`<>)]*/g,
		'[internal path]'
	);
}

function looksLikeInternalPath(value: string): boolean {
	return (
		/^(?:file:\/\/)?\/(?:home|var|tmp|etc|opt|srv|mnt|root|usr)\//.test(
			value
		) || /^[A-Za-z]:\\/.test(value)
	);
}
