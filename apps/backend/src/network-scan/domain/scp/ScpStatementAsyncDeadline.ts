export async function settleWithin<T>(
	request: Promise<T>,
	timeoutMs: number
): Promise<T | 'timed_out'> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			request,
			new Promise<'timed_out'>((resolve) => {
				timeout = setTimeout(() => resolve('timed_out'), timeoutMs);
			})
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}
