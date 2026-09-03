import process from 'node:process';

export const historyArchiveProofRefreshWakeType =
	'history-archive-proof-refresh-ready';

export interface HistoryArchiveProofRefreshWakeMessage {
	readonly type: typeof historyArchiveProofRefreshWakeType;
}

export function isHistoryArchiveProofRefreshWakeMessage(
	message: unknown
): message is HistoryArchiveProofRefreshWakeMessage {
	return (
		typeof message === 'object' &&
		message !== null &&
		'type' in message &&
		message.type === historyArchiveProofRefreshWakeType
	);
}

export function notifyHistoryArchiveProofRefreshReady(): void {
	const message: HistoryArchiveProofRefreshWakeMessage = {
		type: historyArchiveProofRefreshWakeType
	};
	if (process.env.API_HISTORY_MAINTENANCE_WRITER === 'true') {
		process.emit('message', message);
		return;
	}
	if (process.send === undefined || !process.connected) return;
	try {
		process.send(message, undefined, undefined, () => undefined);
	} catch {
		// The durable queue remains authoritative if an API worker is exiting.
	}
}
