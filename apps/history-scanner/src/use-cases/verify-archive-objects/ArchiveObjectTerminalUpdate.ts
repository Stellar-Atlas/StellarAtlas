import type { Result } from 'neverthrow';
import { asyncSleep } from 'shared';

const maximumRetryDelayMs = 30_000;
const retryJitterMs = 250;

export async function retryArchiveObjectTerminalUpdate(
	action: () => Promise<Result<void, Error>>,
	onError: (error: Error) => void
): Promise<void> {
	let attempt = 0;
	for (;;) {
		const result = await action();
		if (result.isOk()) return;

		onError(result.error);
		const delayMs = Math.min(1_000 * 2 ** Math.min(attempt, 5), maximumRetryDelayMs);
		attempt += 1;
		await asyncSleep(delayMs + Math.floor(Math.random() * retryJitterMs));
	}
}
