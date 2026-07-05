import type {
	PublicArchiveScanWorker,
	PublicArchiveScanWorkers,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';

interface ArchiveWorkerJobsProps {
	readonly archiveWorkers: PublicArchiveScanWorkers;
}

const maxVisibleJobs = 8;

export function ArchiveWorkerJobs({
	archiveWorkers
}: ArchiveWorkerJobsProps): React.JSX.Element {
	const workers = [...archiveWorkers.workers].sort(compareWorkers);
	const visibleWorkers = workers.slice(0, maxVisibleJobs);
	const hiddenWorkers = Math.max(
		0,
		workers.length - visibleWorkers.length
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
				{visibleWorkers.length === 0 ? (
					<div className="status-current-empty">
						<strong>No current archive jobs</strong>
						<small>Workers have no fresh or stale taken jobs right now.</small>
					</div>
				) : (
					visibleWorkers.map((worker) => (
						<ArchiveWorkerJobRow
							key={`${worker.archiveUrl}-${worker.claimedAt}-${worker.fromLedger}`}
							worker={worker}
						/>
					))
				)}
				{hiddenWorkers > 0 && (
					<div className="status-current-empty">
						<strong>{formatInteger(hiddenWorkers)} more jobs hidden</strong>
						<small>
							The worker endpoint caps the full snapshot separately.
						</small>
					</div>
				)}
			</div>
		</section>
	);
}

function ArchiveWorkerJobRow({
	worker
}: {
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
		<div className="status-current-job">
			<div>
				<strong title={worker.archiveUrl}>
					{formatArchiveUrl(worker.archiveUrl)}
				</strong>
				<small>
					{formatLedgerRange(worker)}; latest scanned{' '}
					{formatInteger(worker.latestScannedLedger)}
				</small>
			</div>
			<div>
				<span className="status-current-job-meta">
					{concurrencyLabel}
				</span>
				<small>
					Heartbeat {formatDuration(worker.heartbeatAgeMs)} ago, claimed{' '}
					{formatDateTime(worker.claimedAt)}
				</small>
			</div>
			<StatusPill status={status} text={displayStatus} />
		</div>
	);
}

function StatusPill({
	status,
	text
}: {
	readonly status: PublicStatusLevel;
	readonly text: string;
}): React.JSX.Element {
	return <span className={`status-pill ${statusTone(status)}`}>{text}</span>;
}

function formatArchiveUrl(value: string): string {
	try {
		const url = new URL(value);
		return url.hostname;
	} catch {
		return value;
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

function statusTone(status: PublicStatusLevel): 'good' | 'warning' | 'danger' {
	if (status === 'ok') return 'good';
	if (status === 'degraded') return 'warning';
	return 'danger';
}
