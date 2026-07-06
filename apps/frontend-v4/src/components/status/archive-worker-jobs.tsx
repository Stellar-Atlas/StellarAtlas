import Link from 'next/link';
import type {
	PublicArchiveScanWorker,
	PublicArchiveScanWorkerStatus,
	PublicArchiveScanWorkers,
	PublicStatusLevel
} from '@api/types';
import { getArchiveScanDetailPath } from '@domain/archive-scan-routes';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill } from './status-ui';

interface ArchiveWorkerJobsProps {
	readonly archiveWorkers: PublicArchiveScanWorkers;
}

interface DisplayArchiveWorker {
	readonly groupedCount: number;
	readonly worker: PublicArchiveScanWorker;
}

export function ArchiveWorkerJobs({
	archiveWorkers
}: ArchiveWorkerJobsProps): React.JSX.Element {
	const workers = groupWorkers(archiveWorkers.workers).sort((left, right) =>
		compareWorkers(left.worker, right.worker)
	);
	const hiddenWorkers = Math.max(
		0,
		archiveWorkers.totalTakenJobs - archiveWorkers.workers.length
	);
	const groupedDuplicateCount = Math.max(
		0,
		archiveWorkers.workers.length - workers.length
	);
	const runningWorkers = workers.filter(({ worker }) =>
		isRunningWorker(worker)
	).length;
	const startingWorkers = workers.filter(({ worker }) =>
		isStartingWorker(worker)
	).length;

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
					workers.map(({ groupedCount, worker }, index) => (
						<ArchiveWorkerJobRow
							id={getWorkerFragmentId(worker, index)}
							key={`${worker.archiveUrl}-${worker.claimedAt}-${worker.fromLedger}-${index}`}
							groupedCount={groupedCount}
							worker={worker}
						/>
					))
				)}
				{groupedDuplicateCount > 0 && (
					<div className="status-current-empty">
						<strong>
							{formatInteger(groupedDuplicateCount)} duplicate active rows
							grouped
						</strong>
						<small>
							Rows sharing the same archive target and ledger range are shown
							once with the most actionable current state.
						</small>
					</div>
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
	groupedCount,
	id,
	worker
}: {
	readonly groupedCount: number;
	readonly id: string;
	readonly worker: PublicArchiveScanWorker;
}): React.JSX.Element {
	const displayStatus = getDisplayStatus(worker);
	const status: PublicStatusLevel =
		displayStatus === 'scanning' ? 'ok' : 'degraded';
	const workerMetric = getWorkerMetric(worker, displayStatus);

	return (
		<details className="metadata-document" id={id} open={status !== 'ok'}>
			<summary>
				<span>{formatArchiveUrl(worker.archiveUrl)}</span>
				<span>
					<StatusPill
						status={status}
						text={formatWorkerStatus(displayStatus)}
					/>
				</span>
			</summary>
			<dl className="details">
				<div>
					<dt>Range</dt>
					<dd>{formatLedgerRange(worker)}</dd>
				</div>
				<div>
					<dt>Archive detail</dt>
					<dd>
						<Link href={getArchiveScanDetailPath(worker.archiveUrl)}>
							Open scan detail
						</Link>
					</dd>
				</div>
				<div>
					<dt>Latest scanned</dt>
					<dd>{formatInteger(worker.latestScannedLedger)}</dd>
				</div>
				<div>
					<dt>{workerMetric.label}</dt>
					<dd>{workerMetric.value}</dd>
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
				{groupedCount > 1 ? (
					<div>
						<dt>Grouped rows</dt>
						<dd>{formatInteger(groupedCount)}</dd>
					</div>
				) : null}
			</dl>
		</details>
	);
}

function formatArchiveUrl(value: string): string {
	if (looksLikeInternalPath(value)) return 'Internal scanner target';
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			const path = url.pathname.replace(/\/+$/, '');
			return path.length > 0 ? `${url.hostname}${path}` : url.hostname;
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
	if (status === 'pending') return 2;
	return 3;
}

function getDisplayStatus(
	worker: PublicArchiveScanWorker
): PublicArchiveScanWorkerStatus {
	return worker.status;
}

function isRunningWorker(worker: PublicArchiveScanWorker): boolean {
	return getDisplayStatus(worker) === 'scanning';
}

function isStartingWorker(worker: PublicArchiveScanWorker): boolean {
	return getDisplayStatus(worker) === 'starting';
}

function getWorkerMetric(
	worker: PublicArchiveScanWorker,
	status: PublicArchiveScanWorkerStatus
): {
	readonly label: 'Concurrency' | 'Worker state';
	readonly value: string;
} {
	if (
		typeof worker.concurrency === 'number' &&
		Number.isFinite(worker.concurrency) &&
		worker.concurrency > 0
	) {
		return {
			label: 'Concurrency',
			value: `${formatInteger(worker.concurrency)} workers`
		};
	}

	return { label: 'Worker state', value: formatWorkerState(status) };
}

function formatWorkerStatus(status: PublicArchiveScanWorkerStatus): string {
	if (status === 'stale') return 'Delayed';
	if (status === 'pending') return 'Pending';
	if (status === 'starting') return 'Starting';
	return 'Scanning';
}

function formatWorkerState(status: PublicArchiveScanWorkerStatus): string {
	if (status === 'stale') return 'Heartbeat stale';
	if (status === 'pending') return 'Waiting for worker';
	if (status === 'starting') return 'Starting';
	return 'Concurrency not reported';
}

function groupWorkers(
	workers: readonly PublicArchiveScanWorker[]
): DisplayArchiveWorker[] {
	const byKey = new Map<string, DisplayArchiveWorker>();
	for (const worker of workers) {
		const key = getWorkerDedupeKey(worker);
		const existing = byKey.get(key);
		byKey.set(
			key,
			existing === undefined
				? { groupedCount: 1, worker }
				: {
						groupedCount: existing.groupedCount + 1,
						worker: pickPreferredWorker(existing.worker, worker)
					}
		);
	}
	return [...byKey.values()];
}

function getWorkerDedupeKey(worker: PublicArchiveScanWorker): string {
	return `${normalizeArchiveUrl(worker.archiveUrl)}:${worker.fromLedger}:${
		worker.toLedger ?? 'latest'
	}`;
}

function pickPreferredWorker(
	left: PublicArchiveScanWorker,
	right: PublicArchiveScanWorker
): PublicArchiveScanWorker {
	const rankDifference = preferredWorkerRank(right) - preferredWorkerRank(left);
	if (rankDifference > 0) return right;
	if (rankDifference < 0) return left;

	const heartbeatDifference =
		Date.parse(right.lastHeartbeatAt) - Date.parse(left.lastHeartbeatAt);
	if (heartbeatDifference > 0) return right;
	if (heartbeatDifference < 0) return left;

	return right.latestScannedLedger > left.latestScannedLedger ? right : left;
}

function preferredWorkerRank(worker: PublicArchiveScanWorker): number {
	const status = getDisplayStatus(worker);
	if (status === 'scanning') return 4;
	if (status === 'stale') return 3;
	if (status === 'starting') return 2;
	if (status === 'pending') return 1;
	return 0;
}

function normalizeArchiveUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = '';
		url.search = '';
		url.pathname = url.pathname.replace(/\/+$/, '');
		return url.toString().toLowerCase();
	} catch {
		return value.trim().toLowerCase();
	}
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
