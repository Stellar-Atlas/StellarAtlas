const payload = JSON.stringify({
	name: 'Successful event query',
	domain: 'stellaratlas.io',
	url: 'https://stellaratlas.io/explorer/contract-events'
});
let inFlight = 0;

export function recordSuccessfulEventQuery(): void {
	const configured = process.env.ATLAS_ANALYTICS_ORIGIN;
	if (!configured || inFlight >= 2) return;
	let endpoint: URL;
	try {
		const origin = new URL(configured);
		if (origin.origin !== configured) return;
		if (origin.protocol !== 'https:' &&
			!(origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) return;
		endpoint = new URL('/api/event', origin);
	} catch {
		return;
	}
	inFlight++;
	setImmediate(() => {
		void send(endpoint).finally(() => { inFlight--; });
	}).unref();
}

async function send(endpoint: URL): Promise<void> {
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'StellarAtlasTelemetry/1.0'
			},
			body: payload,
			credentials: 'omit',
			redirect: 'error',
			signal: AbortSignal.timeout(2000)
		});
		await response.body?.cancel();
	} catch {
		// No retry or dependency on the API response lifecycle.
	}
}
