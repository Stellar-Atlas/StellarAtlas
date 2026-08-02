import process from 'node:process';
import { injectable } from 'inversify';
import {
	isHistoryArchiveWorkerStatusIpcMessageDTO,
	type HistoryArchiveWorkerReportDTO,
	type HistoryArchiveWorkerStatusIpcMessageDTO
} from 'history-scanner-dto';
import type {
	HistoryArchiveWorkerStatus,
	HistoryArchiveWorkerStatusRepository
} from '../../../domain/history-archive-worker/HistoryArchiveWorkerStatus.js';

const maximumRetainedWorkerRows = 4_096;

@injectable()
export class InMemoryHistoryArchiveWorkerStatusRepository implements HistoryArchiveWorkerStatusRepository {
	private readonly workers = new Map<string, HistoryArchiveWorkerStatus>();

	constructor() {
		process.on('message', (message: unknown) => {
			if (!isHistoryArchiveWorkerStatusIpcMessageDTO(message)) return;
			this.apply(message.report, new Date(message.heartbeatAt));
		});
	}

	async report(
		report: HistoryArchiveWorkerReportDTO,
		heartbeatAt: Date
	): Promise<void> {
		this.apply(report, heartbeatAt);
		if (process.send === undefined || !process.connected) return;

		const message = {
			heartbeatAt: heartbeatAt.toISOString(),
			report,
			type: 'history-archive-worker-status'
		} satisfies HistoryArchiveWorkerStatusIpcMessageDTO;
		try {
			process.send(message, undefined, undefined, () => undefined);
		} catch {
			// The next report retries after a cluster worker replacement.
		}
	}

	async findRecent(options: {
		readonly limit: number;
		readonly observedAfter: Date;
		readonly pruneBefore: Date;
	}): Promise<readonly HistoryArchiveWorkerStatus[]> {
		this.prune(options.pruneBefore);
		return Array.from(this.workers.values())
			.filter((worker) => worker.heartbeatAt >= options.observedAfter)
			.sort(compareWorkers)
			.slice(0, normalizeLimit(options.limit));
	}

	private apply(report: HistoryArchiveWorkerReportDTO, heartbeatAt: Date): void {
		if (Number.isNaN(heartbeatAt.getTime())) return;
		const incoming = mapReport(report, heartbeatAt);
		const current = this.workers.get(report.workerId);
		if (current !== undefined && compareGeneration(incoming, current) <= 0) {
			return;
		}

		this.workers.set(report.workerId, incoming);
		if (this.workers.size <= maximumRetainedWorkerRows) return;
		const oldest = Array.from(this.workers.values()).sort(
			(left, right) => left.heartbeatAt.getTime() - right.heartbeatAt.getTime()
		)[0];
		if (oldest !== undefined) this.workers.delete(oldest.workerId);
	}

	private prune(before: Date): void {
		for (const [workerId, worker] of this.workers) {
			if (worker.heartbeatAt < before) this.workers.delete(workerId);
		}
	}
}

function mapReport(
	report: HistoryArchiveWorkerReportDTO,
	heartbeatAt: Date
): HistoryArchiveWorkerStatus {
	return {
		bytesDownloaded: report.bytesDownloaded,
		bytesTotal: report.bytesTotal ?? null,
		claimAttempt: report.claimAttempt,
		currentObject: report.currentObject,
		heartbeatAt,
		lastOutcome: report.lastOutcome,
		lastOutcomeAt:
			report.lastOutcomeAt === null ? null : new Date(report.lastOutcomeAt),
		pid: report.pid,
		processGeneration: report.processGeneration,
		processId: report.processId,
		processStartedAt: new Date(report.processStartedAt),
		sequence: report.sequence,
		slotIndex: report.slotIndex,
		stage: report.stage,
		workerId: report.workerId
	};
}

function compareGeneration(
	left: HistoryArchiveWorkerStatus,
	right: HistoryArchiveWorkerStatus
): number {
	const started = left.processStartedAt.getTime() - right.processStartedAt.getTime();
	if (started !== 0) return started;
	if (left.processGeneration !== right.processGeneration) {
		return left.processGeneration - right.processGeneration;
	}
	const processId = left.processId.localeCompare(right.processId);
	if (processId !== 0) return processId;
	return left.sequence - right.sequence;
}

function compareWorkers(
	left: HistoryArchiveWorkerStatus,
	right: HistoryArchiveWorkerStatus
): number {
	if (left.slotIndex !== right.slotIndex) return left.slotIndex - right.slotIndex;
	const heartbeat = right.heartbeatAt.getTime() - left.heartbeatAt.getTime();
	if (heartbeat !== 0) return heartbeat;
	const generation = compareGeneration(right, left);
	if (generation !== 0) return generation;
	return left.workerId.localeCompare(right.workerId);
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return maximumRetainedWorkerRows;
	return Math.min(limit, maximumRetainedWorkerRows);
}
