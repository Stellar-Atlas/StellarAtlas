import { createHash } from 'node:crypto';
import { Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import { ProvenanceHttpError } from '../../http/contract-provenance/BoundedProvenanceJson.js';
import type { fetchProtocolRpcJson } from '../ProtocolRpcJson.js';
import { blendFixedSupplyTarget } from '../BlendFixedSupply.js';
import { createBlendSupplyRefreshAdmission } from '../BlendSupplyRefreshAdmission.js';

const rpcUrl = 'https://rpc.example.test/exact';
const wallStart = Date.UTC(2026, 10, 6, 2, 40);
const ledger = 200;
const zeros = Buffer.alloc(32);
const header = new xdr.LedgerHeader({
	ledgerVersion: 23,
	previousLedgerHash: zeros,
	scpValue: new xdr.StellarValue({
		txSetHash: zeros,
		closeTime: 1_700_000_000n,
		upgrades: [],
		ext: xdr.StellarValueExt.stellarValueBasic()
	}),
	txSetResultHash: zeros,
	bucketListHash: zeros,
	ledgerSeq: ledger,
	totalCoins: 0n,
	feePool: 0n,
	inflationSeq: 0,
	idPool: 0n,
	baseFee: 100,
	baseReserve: 5_000_000,
	maxTxSetSize: 1000,
	skipList: [zeros, zeros, zeros, zeros],
	ext: xdr.LedgerHeaderExt.v0()
});
const hash = createHash('sha256').update(header.toXDR()).digest('hex');
const headerXdr = new xdr.LedgerHeaderHistoryEntry({
	header,
	hash: Buffer.from(hash, 'hex'),
	ext: xdr.LedgerHeaderHistoryEntryExt.v0()
}).toXDR('base64');
const snapshot = {
	networkId: blendFixedSupplyTarget.networkId,
	ledger,
	ledgerHash: hash
};

function selection(id: number) {
	return {
		accountId: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, id)),
		snapshot: { ...snapshot }
	};
}

const results = {
	getNetwork: { passphrase: Networks.PUBLIC },
	getLedgerEntries: { latestLedger: ledger, entries: [] },
	getLedgers: {
		latestLedger: ledger,
		ledgers: [{ sequence: ledger, hash, headerXdr }]
	}
};
type Method = keyof typeof results;
type Call = { readonly method: Method; readonly time: number };

function harness(before?: (call: Call, index: number) => void | Promise<void>) {
	let time = 0;
	let wallShift = 0;
	const calls: Call[] = [];
	const request: typeof fetchProtocolRpcJson = async (url, body, options) => {
		expect(url.href).toBe(rpcUrl);
		expect(options?.signal?.aborted).toBe(false);
		const { method, id } = body as { method: Method; id: string };
		const call = { method, time };
		calls.push(call);
		await before?.(call, calls.length);
		return { jsonrpc: '2.0', id, result: results[method] };
	};
	const admission = createBlendSupplyRefreshAdmission(rpcUrl, {
		request,
		monotonicNow: () => time,
		wallNow: () => wallStart + time + wallShift
	});
	return {
		admission,
		calls,
		advance: (ms: number) => {
			time += ms;
		},
		shiftWall: (ms: number) => {
			wallShift += ms;
		}
	};
}

function gate() {
	let open!: () => void;
	let fail!: (error: Error) => void;
	const wait = new Promise<void>((resolve, reject) => {
		open = resolve;
		fail = reject;
	});
	return { wait, open, fail };
}

const methods = (calls: readonly Call[]) => calls.map((call) => call.method);
const throttled = (retryAfter: string | null) =>
	new ProvenanceHttpError(429, 'http', 'busy', retryAfter);

test('keeps reads passive and shares one pending operation after a subscriber leaves', async () => {
	const firstStage = gate();
	const { admission, calls } = harness((_call, index) =>
		index === 1 ? firstStage.wait : undefined
	);
	expect(admission.getState(selection(1))).toEqual({ status: 'unknown' });
	expect(calls).toEqual([]);
	const abandoned = admission.refresh(selection(1));
	expect(admission.getState(selection(1))).toEqual({ status: 'pending' });
	await Promise.resolve();
	const resumed = admission.refresh(selection(1));
	expect(resumed).toBe(abandoned);
	expect(methods(calls)).toEqual(['getNetwork']);
	firstStage.open();

	const completed = await resumed;
	expect(completed).toMatchObject({
		status: 'completed',
		completedAt: wallStart,
		observation: { trust: 'provider_correlated' }
	});
	if (completed.status !== 'completed') throw new Error('Expected completion');
	expect(completed.observation.adapterEvidence).toBeUndefined();
	expect(admission.getState(selection(1))).toBe(completed);
	expect(await admission.refresh(selection(1))).toBe(completed);
	expect(methods(calls)).toEqual([
		'getNetwork',
		'getLedgerEntries',
		'getLedgers'
	]);
});

test('isolates account and snapshot selections, including forks at the same sequence', async () => {
	const stage = gate();
	const { admission, calls } = harness(({ method }) =>
		method === 'getNetwork' ? stage.wait : undefined
	);
	const selected = selection(1);
	const fork = {
		...selected,
		snapshot: { ...selected.snapshot, ledgerHash: 'a'.repeat(64) }
	};
	const first = admission.refresh(selected);
	const second = admission.refresh(fork);
	expect(first).not.toBe(second);
	expect(admission.getState(fork)).toEqual({ status: 'pending' });
	expect(await admission.refresh(selection(2))).toEqual({
		status: 'deferred',
		reason: 'provider_busy'
	});
	stage.open();
	expect(await first).toMatchObject({ status: 'completed' });
	expect(await second).toEqual({ status: 'error', reason: 'provider_error' });
	expect(calls).toHaveLength(6);
});

test('limits concurrent refreshes and charges transport invocations in a rolling window', async () => {
	const both = gate();
	const { admission, calls, advance } = harness(({ method }) =>
		method === 'getNetwork' ? both.wait : undefined
	);
	const first = admission.refresh(selection(1));
	const second = admission.refresh(selection(2));
	expect(await admission.refresh(selection(3))).toEqual({
		status: 'deferred',
		reason: 'provider_busy'
	});
	expect(methods(calls)).toEqual(['getNetwork', 'getNetwork']);
	both.open();
	await Promise.all([first, second]);
	expect(calls).toHaveLength(6);
	advance(9_999);
	expect(await admission.refresh(selection(3))).toEqual({
		status: 'deferred',
		reason: 'request_budget'
	});
	advance(1);
	expect(await admission.refresh(selection(3))).toMatchObject({
		status: 'completed'
	});
	expect(calls).toHaveLength(9);
});

test('retains charges from late stages after the first stage ages out', async () => {
	const stage = gate();
	const { admission, calls, advance } = harness((_call, index) =>
		index === 1 ? stage.wait : undefined
	);
	const first = admission.refresh(selection(1));
	await Promise.resolve();
	advance(9_000);
	stage.open();
	await first;
	await admission.refresh(selection(2));
	expect(calls.map(({ time }) => time)).toEqual([
		0, 9_000, 9_000, 9_000, 9_000, 9_000
	]);
	advance(1_000);
	expect(await admission.refresh(selection(3))).toEqual({
		status: 'deferred',
		reason: 'request_budget'
	});
	advance(9_000);
	expect(await admission.refresh(selection(3))).toMatchObject({
		status: 'completed'
	});
});

test('releases unused reservations after failure while keeping failed request charges', async () => {
	const { admission, calls, advance } = harness(() => {
		throw new Error('offline fixture transport failure');
	});
	for (let id = 1; id <= 4; id++)
		expect(await admission.refresh(selection(id))).toEqual({
			status: 'error',
			reason: 'provider_error'
		});
	expect(await admission.refresh(selection(1))).toEqual({
		status: 'error',
		reason: 'provider_error'
	});
	expect(await admission.refresh(selection(5))).toEqual({
		status: 'deferred',
		reason: 'request_budget'
	});
	expect(calls).toHaveLength(4);
	advance(5_000);
	expect(admission.getState(selection(1))).toEqual({ status: 'unknown' });
	advance(5_000);
	expect(await admission.refresh(selection(5))).toEqual({
		status: 'error',
		reason: 'provider_error'
	});
	expect(calls).toHaveLength(5);
});

test('applies shared Retry-After to new work and to subsequent stages of admitted work', async () => {
	const limited = gate();
	const unaffectedCall = gate();
	const { admission, calls, advance } = harness((_call, index) => {
		if (index === 1) return limited.wait;
		if (index === 2) return unaffectedCall.wait;
	});
	const first = admission.refresh(selection(1));
	const second = admission.refresh(selection(2));
	await Promise.resolve();
	limited.fail(throttled('12'));
	expect(await first).toEqual({
		status: 'error',
		reason: 'rate_limited',
		retryAfter: '12',
		retryAt: wallStart + 12_000
	});
	unaffectedCall.open();
	expect(await second).toMatchObject({
		status: 'error',
		reason: 'rate_limited'
	});
	expect(admission.getState(selection(3))).toEqual({ status: 'unknown' });
	advance(11_999);
	expect(await admission.refresh(selection(3))).toEqual({
		status: 'deferred',
		reason: 'provider_cooldown',
		retryAfter: '12',
		retryAt: wallStart + 12_000
	});
	expect(methods(calls)).toEqual(['getNetwork', 'getNetwork']);
	advance(1);
	expect(await admission.refresh(selection(3))).toMatchObject({
		status: 'completed'
	});
	expect(calls).toHaveLength(5);
});

test('preserves HTTP-date and measures cooldown with a monotonic clock', async () => {
	const retryAfter = new Date(wallStart + 45_000).toUTCString();
	const { admission, calls, advance, shiftWall } = harness((_call, index) => {
		if (index === 1) throw throttled(retryAfter);
	});
	expect(await admission.refresh(selection(1))).toEqual({
		status: 'error',
		reason: 'rate_limited',
		retryAfter,
		retryAt: wallStart + 45_000
	});
	shiftWall(3_600_000);
	advance(44_999);
	expect(await admission.refresh(selection(2))).toMatchObject({
		status: 'deferred',
		reason: 'provider_cooldown',
		retryAfter
	});
	expect(calls).toHaveLength(1);
	advance(1);
	expect(await admission.refresh(selection(2))).toMatchObject({
		status: 'completed'
	});
});

test.each([
	[null, 30_000],
	['bad header', 30_000],
	['Fri, 1', 30_000],
	['Fri, 06 Nov 2026 02:40:45', 30_000],
	['Sun, 29 Feb 2026 02:40:45 GMT', 30_000],
	['Thu, 06 Nov 2026 02:40:45 GMT', 30_000],
	['Fri, 06 Nov 2026 24:00:00 GMT', 30_000],
	['0', 1_000],
	['Fri, 06 Nov 2026 02:39:45 GMT', 1_000],
	['Friday, 06-Nov-26 02:40:45 GMT', 45_000],
	['Fri Nov  6 02:40:45 2026', 45_000],
	['Sunday, 06-Nov-77 08:49:37 GMT', 1_000]
] as const)(
	'applies the correct policy for Retry-After %s',
	async (retryAfter, delay) => {
		const { admission, advance, calls } = harness((_call, index) => {
			if (index === 1) throw throttled(retryAfter);
		});
		expect(await admission.refresh(selection(1))).toEqual({
			status: 'error',
			reason: 'rate_limited',
			retryAfter,
			retryAt: wallStart + delay
		});
		advance(delay - 1);
		expect(await admission.refresh(selection(2))).toMatchObject({
			status: 'deferred',
			reason: 'provider_cooldown'
		});
		expect(calls).toHaveLength(1);
		advance(1);
		expect(await admission.refresh(selection(1))).toMatchObject({
			status: 'completed'
		});
	}
);

test('concurrent 429 responses retain their own header and never shorten the shared cooldown', async () => {
	const short = gate();
	const long = gate();
	const { admission } = harness((_call, index) =>
		index === 1 ? long.wait : short.wait
	);
	const first = admission.refresh(selection(1));
	const second = admission.refresh(selection(2));
	await Promise.resolve();
	long.fail(throttled('60'));
	expect(await first).toMatchObject({
		retryAfter: '60',
		retryAt: wallStart + 60_000
	});
	short.fail(throttled('5'));
	expect(await second).toMatchObject({
		retryAfter: '5',
		retryAt: wallStart + 60_000
	});
	expect(await admission.refresh(selection(3))).toMatchObject({
		retryAfter: '60',
		retryAt: wallStart + 60_000
	});
});

test('evicts old settled entries by capacity and expiry while leaving a passive unknown state', async () => {
	const { admission, calls, advance } = harness();
	for (let id = 1; id <= 5; id++) {
		expect(await admission.refresh(selection(id))).toMatchObject({
			status: 'completed'
		});
		if (id % 2 === 0) advance(10_000);
	}
	expect(admission.getState(selection(1))).toEqual({ status: 'unknown' });
	expect(admission.getState(selection(2))).toMatchObject({
		status: 'completed'
	});
	advance(30_000);
	expect(admission.getState(selection(5))).toEqual({ status: 'unknown' });
	expect(calls).toHaveLength(15);
});

test('rejects invalid provider configuration or selection before transport', () => {
	const { admission, calls } = harness();
	expect(() =>
		createBlendSupplyRefreshAdmission('http://rpc.example.test')
	).toThrow('Invalid Blend refresh provider');
	expect(() =>
		admission.refresh({ ...selection(1), accountId: 'invalid' })
	).toThrow('Invalid Blend refresh selection');
	expect(() =>
		admission.getState({
			...selection(1),
			snapshot: { ...snapshot, networkId: 'a'.repeat(64) }
		})
	).toThrow('Invalid Blend refresh selection');
	expect(calls).toEqual([]);
});
