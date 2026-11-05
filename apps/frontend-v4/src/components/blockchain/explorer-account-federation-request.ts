const deadlineMs = 12_000;
const maxCooldowns = 128;
const cooldowns = new Map<string, number>();

export type FederationNetwork = 'mainnet' | 'testnet';

type Memo = { type: 'id' | 'text' | 'hash'; value: string };

const unresolved = [
	'indexed_evidence_insufficient',
	'unsupported',
	'not_found',
	'mismatch',
	'malformed'
] as const;

export type FederationResult =
	| { status: (typeof unresolved)[number] | 'unavailable' }
	| { status: 'throttled'; retryAtMs: number | null }
	| {
			status: 'display_only';
			stellarAddress: string;
			memo: Memo | null;
			homeDomain: string;
			aliasDomain: string;
			reverseProviderOrigin: string;
			forwardProviderOrigin: string;
			observedLedger: string;
	  };

const unavailable = { status: 'unavailable' } as const;

/** One disposable request for a mounted account view. */
export function startAccountFederationLookup(
	accountId: string,
	network: FederationNetwork,
	report: (result: FederationResult) => void
): () => void {
	const controller = new AbortController();
	const { signal } = controller;
	const key = network + '/' + accountId;
	let deadline: ReturnType<typeof setTimeout> | undefined;

	// Let React's synchronous effect setup/cleanup probe finish before starting I/O.
	queueMicrotask(() => {
		if (signal.aborted) return;
		const retryAtMs = cooldowns.get(key);
		if (retryAtMs !== undefined && retryAtMs > Date.now()) {
			report({ status: 'throttled', retryAtMs });
			return;
		}
		cooldowns.delete(key);
		deadline = setTimeout(() => {
			controller.abort();
			report(unavailable);
		}, deadlineMs);
		void request(accountId, network, signal).then((result) => {
			if (signal.aborted) return;
			clearTimeout(deadline);
			if (result.status === 'throttled' && result.retryAtMs !== null) {
				if (cooldowns.size >= maxCooldowns) {
					const oldest = cooldowns.keys().next();
					if (!oldest.done) cooldowns.delete(oldest.value);
				}
				const previous = cooldowns.get(key) ?? 0;
				cooldowns.set(key, Math.max(previous, result.retryAtMs));
			}
			report(result);
		});
	});

	return () => {
		controller.abort();
		clearTimeout(deadline);
	};
}

async function request(
	accountId: string,
	network: FederationNetwork,
	signal: AbortSignal
): Promise<FederationResult> {
	try {
		const response = await fetch(
			'/v1/explorer/accounts/' + encodeURIComponent(accountId) + '/federation',
			{
				signal,
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				headers: { accept: 'application/json' }
			}
		);
		if (response.status === 429) {
			const header = response.headers.get('retry-after');
			const headerDeadline =
				header && /^[0-9]+$/.test(header)
					? futureDeadline(Date.now() + Number(header) * 1000)
					: null;
			if (headerDeadline !== null)
				return { status: 'throttled', retryAtMs: headerDeadline };
			const body = await response.json().catch(() => null);
			const record = recordOf(body);
			const retryAtMs =
				record?.accountId === accountId &&
				record.network === network &&
				record.status === 'throttled'
					? futureDeadline(record.retryAtMs)
					: null;
			return { status: 'throttled', retryAtMs };
		}
		if (response.status !== 200) return unavailable;
		return parseResult(await response.json(), accountId, network);
	} catch {
		return unavailable;
	}
}

function parseResult(
	value: unknown,
	accountId: string,
	network: FederationNetwork
): FederationResult {
	const row = recordOf(value);
	if (row?.accountId !== accountId || row.network !== network)
		return unavailable;
	for (const status of unresolved) {
		if (row.status === status) return { status };
	}
	const {
		stellarAddress,
		homeDomain,
		aliasDomain,
		reverseProviderOrigin,
		forwardProviderOrigin,
		observedLedger
	} = row;
	const memo = parseMemo(row.memo);
	if (
		row.status !== 'display_only' ||
		!textWithin(stellarAddress, 512) ||
		!textWithin(homeDomain, 253) ||
		!textWithin(aliasDomain, 253) ||
		!isHttpsOrigin(reverseProviderOrigin) ||
		!isHttpsOrigin(forwardProviderOrigin) ||
		typeof observedLedger !== 'string' ||
		!/^[1-9][0-9]{0,19}$/.test(observedLedger) ||
		memo === undefined
	)
		return unavailable;
	return {
		status: 'display_only',
		stellarAddress,
		memo,
		homeDomain,
		aliasDomain,
		reverseProviderOrigin,
		forwardProviderOrigin,
		observedLedger
	};
}

function parseMemo(input: unknown): Memo | null | undefined {
	if (input === null) return null;
	const memo = recordOf(input);
	if (!memo || typeof memo.value !== 'string' || memo.value.length > 44)
		return undefined;
	const { type, value } = memo;
	if (type === 'text' || type === 'id' || type === 'hash')
		return { type, value };
	return undefined;
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function textWithin(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isHttpsOrigin(value: unknown): value is string {
	if (!textWithin(value, 261)) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.origin === value;
	} catch {
		return false;
	}
}

function futureDeadline(value: unknown): number | null {
	return typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value > Date.now() &&
		value <= 8.64e15
		? value
		: null;
}
