export type ExplorerRequestOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly message: string };

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
	} catch {
		return { ok: false, message: failureMessage };
	}
}
