export type ExplorerRequestOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly message: string };

class ExplorerRequestDeadline extends Error {}

export async function withExplorerRequestDeadline<T>(
	controller: AbortController,
	milliseconds: number,
	action: () => Promise<T>
): Promise<T> {
	const deadline = new ExplorerRequestDeadline(
		`This request timed out in the browser after ${milliseconds / 1000} seconds. Try again.`
	);
	const timer = setTimeout(() => controller.abort(deadline), milliseconds);
	try {
		const value = await action();
		controller.signal.throwIfAborted();
		return value;
	} catch (error) {
		// Body reads may reject with AbortError rather than fetch's abort reason.
		throw controller.signal.reason === deadline ? deadline : error;
	} finally {
		clearTimeout(timer);
	}
}

export function explorerResponseError(value: unknown): string | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('status' in value) ||
		value.status !== 'unavailable'
	)
		return null;
	return 'message' in value &&
		typeof value.message === 'string' &&
		value.message
		? value.message
		: 'The data service is unavailable. Please try again.';
}

export async function executeExplorerRequest<T>(
	action: () => Promise<T>,
	failureMessage: string
): Promise<ExplorerRequestOutcome<T>> {
	try {
		const value = await action();
		const message = explorerResponseError(value);
		return message === null ? { ok: true, value } : { ok: false, message };
	} catch (error) {
		return {
			ok: false,
			message: error instanceof ExplorerRequestDeadline ? error.message : failureMessage
		};
	}
}
