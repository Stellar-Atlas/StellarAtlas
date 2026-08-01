import { randomUUID } from 'node:crypto';
import process from 'node:process';
import type { Worker } from 'node:cluster';

const requestType = 'history-archive-download-permit-request';
const grantType = 'history-archive-download-permit-grant';
const releaseType = 'history-archive-download-permit-release';

type PermitRequest = {
	readonly requestId: string;
	readonly type: typeof requestType;
};

type PermitGrant = {
	readonly requestId: string;
	readonly type: typeof grantType;
};

type PermitRelease = {
	readonly requestId: string;
	readonly type: typeof releaseType;
};

type PermitMessage = PermitRequest | PermitGrant | PermitRelease;

export interface HistoryArchiveDownloadPermit {
	acquire(): Promise<() => void>;
}

export class ProcessHistoryArchiveDownloadPermit implements HistoryArchiveDownloadPermit {
	private readonly pending = new Map<
		string,
		{
			readonly reject: (error: Error) => void;
			readonly resolve: (readRelease: () => void) => void;
		}
	>();

	constructor() {
		process.on('message', (message: unknown) => this.handleMessage(message));
		process.on('disconnect', () => this.rejectPending());
	}

	async acquire(): Promise<() => void> {
		if (process.env.HISTORY_OBJECT_WORKER_INDEX === undefined) {
			return () => undefined;
		}
		if (process.send === undefined || !process.connected) {
			throw new Error(
				'History archive download permit coordinator is unavailable'
			);
		}

		const requestId = randomUUID();
		return new Promise<() => void>((resolve, reject) => {
			this.pending.set(requestId, { reject, resolve });
			process.send?.(
				{ requestId, type: requestType } satisfies PermitRequest,
				(error) => {
					if (error === null) return;
					this.pending.delete(requestId);
					reject(error);
				}
			);
		});
	}

	private handleMessage(message: unknown): void {
		if (!isPermitMessage(message) || message.type !== grantType) return;
		const pending = this.pending.get(message.requestId);
		if (pending === undefined) return;

		this.pending.delete(message.requestId);
		let released = false;
		pending.resolve(() => {
			if (released) return;
			released = true;
			process.send?.({
				requestId: message.requestId,
				type: releaseType
			} satisfies PermitRelease);
		});
	}

	private rejectPending(): void {
		const error = new Error(
			'History archive download permit coordinator disconnected'
		);
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}

export class HistoryArchiveDownloadPermitCoordinator {
	private readonly active = new Map<number, string>();
	private readonly waiting: Array<{
		readonly requestId: string;
		readonly worker: Worker;
	}> = [];

	constructor(private readonly maximumActiveDownloads: number) {}

	handleMessage(worker: Worker, message: unknown): void {
		if (!isPermitMessage(message)) return;
		if (message.type === requestType) {
			this.request(worker, message.requestId);
			return;
		}
		if (message.type === releaseType) {
			this.release(worker.id, message.requestId);
		}
	}

	removeWorker(workerId: number): void {
		this.active.delete(workerId);
		for (let index = this.waiting.length - 1; index >= 0; index--) {
			if (this.waiting[index]?.worker.id === workerId)
				this.waiting.splice(index, 1);
		}
		this.grantWaiting();
	}

	private request(worker: Worker, requestId: string): void {
		if (this.active.has(worker.id)) return;
		if (
			this.waiting.some(
				(entry) =>
					entry.worker.id === worker.id || entry.requestId === requestId
			)
		) {
			return;
		}

		this.waiting.push({ requestId, worker });
		this.grantWaiting();
	}

	private release(workerId: number, requestId: string): void {
		if (this.active.get(workerId) !== requestId) return;
		this.active.delete(workerId);
		this.grantWaiting();
	}

	private grantWaiting(): void {
		while (
			this.active.size < this.maximumActiveDownloads &&
			this.waiting.length > 0
		) {
			const next = this.waiting.shift();
			if (next === undefined || !next.worker.isConnected()) continue;
			this.active.set(next.worker.id, next.requestId);
			try {
				next.worker.send({
					requestId: next.requestId,
					type: grantType
				} satisfies PermitGrant);
			} catch {
				this.active.delete(next.worker.id);
			}
		}
	}
}

function isPermitMessage(value: unknown): value is PermitMessage {
	if (typeof value !== 'object' || value === null) return false;
	if (!('type' in value) || !('requestId' in value)) return false;
	return (
		typeof value.requestId === 'string' &&
		(value.type === requestType ||
			value.type === grantType ||
			value.type === releaseType)
	);
}
