import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';

const requestSignal = new AsyncLocalStorage<AbortSignal>();

export function currentHubbleRequestSignal(): AbortSignal | undefined {
	return requestSignal.getStore();
}

export async function withHubbleRequestCancellation<T>(
	request: Pick<IncomingMessage, 'once' | 'off' | 'aborted'>,
	response: Pick<
		ServerResponse,
		'once' | 'off' | 'writableEnded' | 'destroyed'
	>,
	work: () => Promise<T>
): Promise<T> {
	const controller = new AbortController();
	const onAbort = (): void => controller.abort();
	const onClose = (): void => {
		if (!response.writableEnded) controller.abort();
	};
	request.once('aborted', onAbort);
	if (request.aborted || (response.destroyed && !response.writableEnded))
		controller.abort();
	response.once('close', onClose);
	try {
		return await requestSignal.run(controller.signal, work);
	} finally {
		request.off('aborted', onAbort);
		response.off('close', onClose);
	}
}
