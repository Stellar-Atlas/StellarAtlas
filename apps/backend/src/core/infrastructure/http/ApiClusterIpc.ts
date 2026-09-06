import type { Serializable } from 'node:child_process';

export interface ApiIpcWorker {
	readonly id: number;
	isConnected(): boolean;
	send(message: Serializable, callback: (error: Error | null) => void): boolean;
}
type IpcErrorLogger = (workerId: number, error: unknown) => void;

/** Best-effort notifications only; durable recovery does not depend on this send. */
export function sendApiWorkerMessage(
	worker: ApiIpcWorker,
	message: Serializable,
	logError: IpcErrorLogger = logUnexpectedIpcError
): void {
	const reportError = (error: unknown): void => {
		if (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 'ERR_IPC_CHANNEL_CLOSED'
		)
			return;
		logError(worker.id, error);
	};
	try {
		if (!worker.isConnected()) return;
		// A worker can disconnect after the precheck. Node calls this callback instead
		// of emitting an unhandled asynchronous error when the channel closes.
		worker.send(message, (error) => {
			if (error !== null) reportError(error);
		});
	} catch (error: unknown) {
		reportError(error);
	}
}
function logUnexpectedIpcError(workerId: number, error: unknown): void {
	console.error('[api-cluster] IPC send failed for worker ' + workerId, error);
}
