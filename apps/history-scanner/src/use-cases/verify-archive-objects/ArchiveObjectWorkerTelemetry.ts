import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { ExceptionLogger } from 'exception-logger';
import type { Logger } from 'logger';
import { mapUnknownToError } from 'shared';
import type {
	HistoryArchiveWorkerOutcomeDTO,
	HistoryArchiveWorkerReportDTO,
	HistoryArchiveWorkerStageDTO
} from 'history-scanner-dto';
import type {
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../domain/scan/ScanCoordinatorService.js';
import type { HistoryArchiveWorkerReportSink } from './CoalescingHistoryArchiveWorkerReporter.js';

interface ActiveObjectProgress {
	readonly archiveUrl: string;
	bytesDownloaded: number | null;
	readonly claimAttempt: number;
	readonly objectType: HistoryArchiveObjectJobDTO['objectType'];
	readonly remoteId: string;
	readonly slot: number;
	workerStage: HistoryArchiveWorkerStageDTO;
}

interface WorkerOutcomeState {
	readonly at: string | null;
	readonly outcome: HistoryArchiveWorkerOutcomeDTO;
}

export interface HistoryArchiveWorkerProcessIdentity {
	readonly pid: number;
	readonly processGeneration: number;
	readonly processId: string;
	readonly processStartedAt: string;
	readonly workerIdPrefix: string;
}

const initialHeartbeatDelayMs = 2 * 1000;
const heartbeatIntervalMs = 5 * 1000;
const heartbeatJitterMs = 2 * 1000;

export class ArchiveObjectWorkerTelemetry {
	private readonly activeObjects = new Map<string, ActiveObjectProgress>();
	private readonly heartbeatsInFlight = new Map<string, Promise<void>>();
	private readonly heartbeatTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private readonly outcomes = new Map<number, WorkerOutcomeState>();
	private readonly reportSequences = new Map<number, number>();
	private readonly stoppingObjects = new Set<string>();

	constructor(
		private readonly scanCoordinator: ScanCoordinatorService,
		private readonly statusReporter: HistoryArchiveWorkerReportSink,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly logger: Logger,
		private readonly identity = createHistoryArchiveWorkerProcessIdentity(),
		private readonly now: () => Date = () => new Date()
	) {}

	reportIdle(slot: number): void {
		this.statusReporter.enqueue(this.createReport(slot, null));
	}

	startObject(slot: number, job: HistoryArchiveObjectJobDTO): void {
		const progress: ActiveObjectProgress = {
			archiveUrl: job.archiveUrl,
			bytesDownloaded: null,
			claimAttempt: job.claimAttempt,
			objectType: job.objectType,
			remoteId: job.remoteId,
			slot,
			workerStage: 'claimed'
		};
		this.stoppingObjects.delete(job.remoteId);
		this.activeObjects.set(job.remoteId, progress);
		this.statusReporter.enqueue(this.createReport(slot, progress));
		this.scheduleHeartbeat(
			job.remoteId,
			initialHeartbeatDelayMs + Math.floor(Math.random() * heartbeatJitterMs)
		);
	}

	updateProgress(
		remoteId: string,
		workerStage: HistoryArchiveWorkerStageDTO,
		bytesDownloaded: number | null
	): void {
		const progress = this.activeObjects.get(remoteId);
		if (progress === undefined) return;
		progress.workerStage = workerStage;
		progress.bytesDownloaded = bytesDownloaded;
		this.statusReporter.enqueue(this.createReport(progress.slot, progress));
	}

	async finishObject(
		remoteId: string,
		outcome: HistoryArchiveWorkerOutcomeDTO
	): Promise<void> {
		const progress = this.activeObjects.get(remoteId);
		if (progress === undefined) return;
		this.stoppingObjects.add(remoteId);
		this.stopHeartbeat(remoteId);
		this.activeObjects.delete(remoteId);
		await this.heartbeatsInFlight.get(remoteId);
		this.outcomes.set(progress.slot, {
			at: this.now().toISOString(),
			outcome
		});
		this.reportIdle(progress.slot);
		this.stoppingObjects.delete(remoteId);
	}

	async heartbeatObject(remoteId: string): Promise<void> {
		const inFlight = this.heartbeatsInFlight.get(remoteId);
		if (inFlight !== undefined) return inFlight;
		const progress = this.activeObjects.get(remoteId);
		if (progress === undefined) return;

		const heartbeat = this.writeHeartbeat(remoteId, progress).finally(() => {
			this.heartbeatsInFlight.delete(remoteId);
		});
		this.heartbeatsInFlight.set(remoteId, heartbeat);
		return heartbeat;
	}

	private async writeHeartbeat(
		remoteId: string,
		progress: ActiveObjectProgress
	): Promise<void> {
		try {
			this.statusReporter.enqueue(this.createReport(progress.slot, progress));
			const touchResult = await this.scanCoordinator.touchHistoryArchiveObject(
				remoteId,
				{
					bytesDownloaded: progress.bytesDownloaded,
					claimAttempt: progress.claimAttempt,
					workerStage: progress.workerStage
				}
			);
			if (touchResult.isErr()) {
				this.exceptionLogger.captureException(touchResult.error);
			}
		} catch (error) {
			this.exceptionLogger.captureException(mapUnknownToError(error));
		}
	}

	async releaseActiveObjectJobs(): Promise<void> {
		const activeObjects = Array.from(this.activeObjects.values());
		for (const progress of activeObjects) {
			this.stoppingObjects.add(progress.remoteId);
			this.stopHeartbeat(progress.remoteId);
		}

		await Promise.all(
			activeObjects.map(async (progress) => {
				const result = await this.scanCoordinator.releaseHistoryArchiveObject(
					progress.remoteId,
					progress.claimAttempt
				);
				if (result.isOk()) {
					await this.finishObject(progress.remoteId, 'released');
					return;
				}

				this.exceptionLogger.captureException(result.error);
				this.logger.warn(
					'Failed to release active history archive object job',
					{ remoteId: progress.remoteId }
				);
				this.outcomes.set(progress.slot, {
					at: this.now().toISOString(),
					outcome: 'worker_issue'
				});
				await this.heartbeatsInFlight.get(progress.remoteId);
				this.statusReporter.enqueue(this.createReport(progress.slot, progress));
			})
		);
	}

	private scheduleHeartbeat(remoteId: string, delayMs: number): void {
		const timer = setTimeout(() => {
			if (
				!this.activeObjects.has(remoteId) ||
				this.stoppingObjects.has(remoteId)
			) {
				return;
			}
			void this.heartbeatObject(remoteId).finally(() => {
				if (
					this.activeObjects.has(remoteId) &&
					!this.stoppingObjects.has(remoteId)
				) {
					this.scheduleHeartbeat(remoteId, heartbeatIntervalMs);
				}
			});
		}, delayMs);
		this.heartbeatTimers.set(remoteId, timer);
	}

	private stopHeartbeat(remoteId: string): void {
		const timer = this.heartbeatTimers.get(remoteId);
		if (timer !== undefined) clearTimeout(timer);
		this.heartbeatTimers.delete(remoteId);
	}

	private createReport(
		slot: number,
		progress: ActiveObjectProgress | null
	): HistoryArchiveWorkerReportDTO {
		const outcome = this.outcomes.get(slot) ?? { at: null, outcome: 'none' };
		const sequence = (this.reportSequences.get(slot) ?? 0) + 1;
		this.reportSequences.set(slot, sequence);
		return {
			bytesDownloaded: progress?.bytesDownloaded ?? null,
			claimAttempt: progress?.claimAttempt ?? null,
			currentObject:
				progress === null
					? null
					: {
							remoteId: progress.remoteId,
							source: progress.archiveUrl,
							type: progress.objectType
						},
			lastOutcome: outcome.outcome,
			lastOutcomeAt: outcome.at,
			pid: this.identity.pid,
			processGeneration: this.identity.processGeneration,
			processId: this.identity.processId,
			processStartedAt: this.identity.processStartedAt,
			sequence,
			stage: progress?.workerStage ?? 'idle',
			workerId: `${this.identity.workerIdPrefix}-${slot.toString()}`
		};
	}
}

export function createHistoryArchiveWorkerProcessIdentity(
	env: NodeJS.ProcessEnv = process.env,
	host = hostname(),
	pid = process.pid,
	processStartedAt = new Date(),
	processId = randomUUID()
): HistoryArchiveWorkerProcessIdentity {
	const hostHash = createHash('sha256').update(host).digest('hex').slice(0, 10);
	const configuredProcessIndex = readProcessIndex(
		env.HISTORY_OBJECT_WORKER_INDEX
	);
	const processGeneration =
		readProcessIndex(env.HISTORY_OBJECT_WORKER_GENERATION) ?? 0;
	const processSlot = configuredProcessIndex ?? pid;

	return {
		pid,
		processGeneration,
		processId,
		processStartedAt: processStartedAt.toISOString(),
		workerIdPrefix: `object-${hostHash}-${processSlot.toString()}`
	};
}

export function mapFailureToWorkerOutcome(
	failure: HistoryArchiveObjectFailureDTO
): HistoryArchiveWorkerOutcomeDTO {
	return failure.failureChannel === 'scanner_issue'
		? 'worker_issue'
		: 'archive_error';
}

function readProcessIndex(value: string | undefined): number | null {
	if (value === undefined || value.trim() === '') return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
