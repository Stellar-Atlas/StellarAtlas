import type { Result } from 'neverthrow';
import { asyncSleep } from 'shared';

const maximumRetryDelayMs = 30_000;
const maximumAttempts = 3;
const retryJitterMs = 250;

export async function retryArchiveObjectTerminalUpdate(
	action: () => Promise<Result<void, Error>>,
	onError: (error: Error) => void
): Promise<void> {
	for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
		const result = await action();
		if (result.isOk()) return;

		onError(result.error);
		if (attempt === maximumAttempts - 1) throw result.error;

		const delayMs = Math.min(
			1_000 * 2 ** attempt,
			maximumRetryDelayMs
		);
		await asyncSleep(delayMs + Math.floor(Math.random() * retryJitterMs));
	}
}
