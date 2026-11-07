const maximumBodyBytes = 2 * 1024 * 1024;

export class HorizonAccountReadError extends Error {
	constructor(readonly retryAfterSeconds: number = 5) {
		super('Horizon account request unavailable');
	}
}

export function accountRetryAfter(response: Response): number {
	const value = response.headers.get('retry-after');
	if (value === null) return 5;
	const seconds = /^\d{1,9}$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
	return Number.isFinite(seconds) ? Math.min(300, Math.max(5, seconds)) : 5;
}

/** Read and validate a complete bounded UTF-8 body before parsing or sharing it. */
export async function readHorizonAccountJson(response: Response, signal: AbortSignal): Promise<unknown> {
	const length = response.headers.get('content-length');
	if (!response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBodyBytes))) {
		await response.body?.cancel().catch(() => undefined);
		throw new HorizonAccountReadError();
	}
	const reader = response.body.getReader();
	let cancellation: Promise<void> | undefined;
	const cancel = (): Promise<void> => cancellation ??= reader.cancel().catch(() => undefined);
	const abort = () => { void cancel(); };
	signal.addEventListener('abort', abort, { once: true });
	let bytes = 0, text = '';
	const decoder = new TextDecoder('utf-8', { fatal: true });
	try {
		signal.throwIfAborted();
		for (;;) {
			const item = await reader.read();
			signal.throwIfAborted();
			if (item.done) break;
			bytes += item.value.byteLength;
			if (bytes > maximumBodyBytes) throw new HorizonAccountReadError();
			text += decoder.decode(item.value, { stream: true });
		}
		text += decoder.decode();
		if (length !== null && !response.headers.get('content-encoding') && Number(length) !== bytes)
			throw new HorizonAccountReadError();
		return JSON.parse(text) as unknown;
	} catch {
		if (signal.aborted) signal.throwIfAborted();
		throw new HorizonAccountReadError();
	} finally {
		signal.removeEventListener('abort', abort);
		await cancel();
		reader.releaseLock();
	}
}
