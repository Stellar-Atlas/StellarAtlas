export async function runWithFullHistoryBackfillLease<Result>(input: {
	readonly leaseDurationMs: number;
	readonly renew: () => Promise<unknown>;
	readonly work: () => Promise<Result>;
}): Promise<Result> {
	await input.renew();
	const controller = new AbortController();
	const renewal = maintainLease(
		input.leaseDurationMs,
		input.renew,
		controller.signal
	).then<LeaseRenewalResult, LeaseRenewalResult>(
		() => ({ status: 'stopped' }),
		(error: unknown) => ({ error, status: 'failed' })
	);
	try {
		const result = await input.work();
		controller.abort();
		throwIfLeaseRenewalFailed(await renewal);
		return result;
	} catch (workError) {
		controller.abort();
		throwIfLeaseRenewalFailed(await renewal);
		throw workError;
	}
}

type LeaseRenewalResult =
	| { readonly error: unknown; readonly status: 'failed' }
	| { readonly status: 'stopped' };

function throwIfLeaseRenewalFailed(result: LeaseRenewalResult): void {
	if (result.status === 'failed') throw result.error;
}

async function maintainLease(
	leaseDurationMs: number,
	renew: () => Promise<unknown>,
	signal: AbortSignal
): Promise<void> {
	const renewalIntervalMs = Math.max(250, Math.floor(leaseDurationMs / 3));
	while (await waitForRenewal(renewalIntervalMs, signal)) {
		await renew();
	}
}

async function waitForRenewal(
	delayMs: number,
	signal: AbortSignal
): Promise<boolean> {
	if (signal.aborted) return false;
	return new Promise<boolean>((resolve) => {
		const onAbort = (): void => {
			clearTimeout(timer);
			resolve(false);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve(true);
		}, delayMs);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}
