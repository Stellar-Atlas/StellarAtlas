import { jest } from '@jest/globals';
import { fetchExplorerAccount, type ExplorerAccountDTO } from '../ExplorerAccountClient.js';
import { createExplorerAccountProvider } from '../ExplorerAccountProvider.js';
import { HorizonAccountReadError } from '../HorizonAccountResponse.js';

const config = { url: 'https://provider.example.org/', hostname: 'provider.example.org' };
const account: ExplorerAccountDTO = { accountId: 'G', balances: [], sequence: '1', source: 'horizon', subentryCount: 0, lastModifiedLedger: null };
const signal = () => new AbortController().signal;
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

it('shares matching readers and retains an attributed short-lived result, not a second provider', async () => {
	let now = 1_000_000;
	const pending = deferred<ExplorerAccountDTO | null>();
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockReturnValueOnce(pending.promise).mockResolvedValue(account);
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	const first = service.read('G', signal()), second = service.read('G', signal());
	await Promise.resolve();
	expect(fetchAccount).toHaveBeenCalledTimes(1);
	pending.resolve(account);
	const [a, b] = await Promise.all([first, second]);
	expect(a).toBe(b);
	expect(a?.provider).toEqual({ mode: 'operator_alternate', hostname: config.hostname, observedAt: new Date(now).toISOString() });
	expect(await service.read('G', signal())).toBe(a);
	expect(fetchAccount.mock.calls[0]?.[0]).toBe(config.url);
	now += 20_001;
	await service.read('G', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(2);
});

it('rejects excess distinct work and callers without creating a waiting-work queue', async () => {
	const pending = deferred<ExplorerAccountDTO | null>();
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockReturnValue(pending.promise);
	const service = createExplorerAccountProvider(config, 'network', { fetchAccount });
	const active = Array.from({ length: 4 }, (_, index) => service.read(String(index), signal()));
	await expect(service.read('excess', signal())).rejects.toMatchObject({ status: 429 });
	const joined = Array.from({ length: 60 }, () => service.read('0', signal()));
	await expect(service.read('0', signal())).rejects.toMatchObject({ status: 429 });
	await Promise.resolve();
	expect(fetchAccount).toHaveBeenCalledTimes(4);
	pending.resolve(account);
	await Promise.all([...active, ...joined]);
	await expect(service.read('rate-limited', signal())).rejects.toMatchObject({ status: 429 });
});

it('does not cancel other waiters or overlap a replacement while the last waiter is cancelling', async () => {
	const pending = deferred<ExplorerAccountDTO | null>();
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockReturnValueOnce(pending.promise).mockResolvedValue(account);
	const service = createExplorerAccountProvider(config, 'network', { fetchAccount });
	const a = new AbortController(), b = new AbortController();
	const first = service.read('G', a.signal), second = service.read('G', b.signal);
	await Promise.resolve();
	const upstream = fetchAccount.mock.calls[0]?.[2]?.signal;
	a.abort(new Error('First left'));
	await expect(first).rejects.toThrow('First left');
	expect(upstream?.aborted).toBe(false);
	b.abort(new Error('Last left'));
	await expect(second).rejects.toThrow('Last left');
	expect(upstream?.aborted).toBe(true);
	await expect(service.read('G', signal())).rejects.toMatchObject({ status: 429 });
	pending.resolve(account);
	// Allow the cancelled upstream's complete then/catch/finally chain to settle.
	await new Promise(resolve => setImmediate(resolve));
	await service.read('G', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(2);
});

it('honors bounded Retry-After and never automatically retries or selects the native endpoint', async () => {
	let now = 1_000_000;
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockRejectedValueOnce(new HorizonAccountReadError(120)).mockResolvedValue(account);
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	await expect(service.read('G', signal())).rejects.toMatchObject({ status: 503, retryAfterSeconds: 120 });
	await expect(service.read('other', signal())).rejects.toMatchObject({ status: 503, retryAfterSeconds: 120 });
	expect(fetchAccount).toHaveBeenCalledTimes(1);
	now += 120_001;
	await service.read('G', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(2);
	expect(fetchAccount.mock.calls.every(call => call[0] === config.url)).toBe(true);
});

it('bounds retained serialized bytes, refuses oversized values and briefly reuses not-found results', async () => {
	let now = 1_000_000;
	// Synthetic mapped DTO exercises the cache's byte accounting, not account validation.
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue({ ...account, sequence: '1'.repeat(1_800_000) });
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	for (let index = 0; index < 5; index++) {
		now += 2_001;
		await service.read(String(index), signal());
	}
	await service.read('4', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(5);
	await service.read('0', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(6);
	const absent = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue(null);
	const missing = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount: absent });
	expect(await missing.read('G', signal())).toBeNull();
	expect(await missing.read('G', signal())).toBeNull();
	expect(absent).toHaveBeenCalledTimes(1);
	now += 5_001;
	await missing.read('G', signal());
	expect(absent).toHaveBeenCalledTimes(2);
	const huge = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue({ ...account, sequence: '1'.repeat(2 * 1024 * 1024) });
	await expect(createExplorerAccountProvider(config, 'network', { fetchAccount: huge }).read('G', signal())).rejects.toMatchObject({ status: 503 });
});
