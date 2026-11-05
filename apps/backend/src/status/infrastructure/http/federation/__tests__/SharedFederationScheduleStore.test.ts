import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { SafeResponse } from '../../asset-metadata/safeHttp.js';
import { ScheduledFederationProviderBudget } from '../FederationProviderBudget.js';
import { SharedFederationScheduleStore } from '../SharedFederationScheduleStore.js';

const provider = 'shared.example';
const stateFile = 'federation-schedule.json';
const lockFile = 'federation-schedule.lock';
const reply = (status: number, headers = {}): SafeResponse => ({
	status,
	headers,
	body: Buffer.from('sensitive alias and memo')
});

describe('shared federation schedule', () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'atlas-federation-budget-'));
	});
	afterEach(async () => {
		for (const file of [stateFile, lockFile, 'federation-schedule.next']) {
			await unlink(join(directory, file)).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT') throw error;
				}
			);
		}
		await rmdir(directory);
	});

	it('enforces active and retry limits across independent owners of the same store', async () => {
		const now = () => 10_000;
		const one = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(directory),
			now
		);
		const two = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(directory),
			now
		);
		let release!: (value: SafeResponse) => void;
		let entered = 0;
		let bothEntered!: () => void;
		const gate = new Promise<SafeResponse>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			bothEntered = resolve;
		});
		const hold = async () => {
			if (++entered === 2) bothEntered();
			return gate;
		};
		const requests = [one.run(provider, hold), two.run(provider, hold)];
		const next = jest.fn(async () => reply(200));
		try {
			await Promise.race([started, Promise.all(requests)]);
			await expect(two.run(provider, next)).rejects.toMatchObject({
				retryAtMs: 11_000
			});
			expect(next).not.toHaveBeenCalled();
		} finally {
			release(reply(429, { 'retry-after': '90' }));
			await Promise.allSettled(requests);
		}
		await expect(one.run(provider, next)).rejects.toMatchObject({
			retryAtMs: 100_000
		});
		await expect(two.run(provider, next)).rejects.toMatchObject({
			retryAtMs: 100_000
		});
		expect(next).not.toHaveBeenCalled();
		const state = JSON.parse(
			await readFile(join(directory, stateFile), 'utf8')
		);
		expect(state).toEqual([[provider, 70_000, 2, 0, 2, 100_000]]);
	});

	it('keeps the request window across replacement budget instances', async () => {
		const now = () => 10_000;
		const one = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(directory),
			now
		);
		for (let index = 0; index < 8; index++)
			await one.run(provider, async () => reply(200));
		const two = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(directory),
			now
		);
		const request = jest.fn(async () => reply(200));
		await expect(two.run(provider, request)).rejects.toMatchObject({
			retryAtMs: 70_000
		});
		expect(request).not.toHaveBeenCalled();
	});

	it('completes once after contention outlasts the admission lock wait', async () => {
		const budget = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(directory),
			() => 10_000
		);
		let release!: (value: SafeResponse) => void;
		const gate = new Promise<SafeResponse>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const request = jest.fn(() => {
			entered();
			return gate;
		});
		const outcome = budget
			.run(provider, request)
			.catch((error: unknown) => error);
		await started;
		const foreignLock = join(directory, lockFile);
		await writeFile(foreignLock, 'other owner', { flag: 'wx' });
		try {
			release(reply(200));
			await setTimeout(400);
			expect(await readFile(foreignLock, 'utf8')).toBe('other owner');
			expect(
				JSON.parse(await readFile(join(directory, stateFile), 'utf8'))
			).toEqual([[provider, 70_000, 1, 1, 0, 0]]);
		} finally {
			await unlink(foreignLock);
		}
		await expect(outcome).resolves.toMatchObject({ status: 200 });
		expect(request).toHaveBeenCalledTimes(1);
		expect(
			JSON.parse(await readFile(join(directory, stateFile), 'utf8'))
		).toEqual([[provider, 70_000, 1, 0, 0, 0]]);
	});

	it('does not steal an abandoned lock or send a request when coordination is unavailable', async () => {
		await writeFile(join(directory, lockFile), '', { flag: 'wx' });
		const budget = new ScheduledFederationProviderBudget(
			new SharedFederationScheduleStore(directory)
		);
		const request = jest.fn(async () => reply(200));
		await expect(budget.run(provider, request)).rejects.toThrow(
			'busy or needs recovery'
		);
		expect(request).not.toHaveBeenCalled();
		expect(await readFile(join(directory, lockFile), 'utf8')).toBe('');
	});

	it('lets the caller deadline end while metadata-only completion remains queued', async () => {
		let now = 10_000;
		const store = new SharedFederationScheduleStore(directory);
		const budget = new ScheduledFederationProviderBudget(store, () => now);
		const controller = new AbortController();
		let release!: (value: SafeResponse) => void;
		const gate = new Promise<SafeResponse>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const request = jest.fn(() => {
			entered();
			return gate;
		});
		const outcome = budget
			.run(provider, request, controller.signal)
			.catch((error: unknown) => error);
		await started;
		const foreignLock = join(directory, lockFile);
		await writeFile(foreignLock, 'other owner', { flag: 'wx' });
		const deadline = new Error('Lookup deadline');
		try {
			release(reply(429, { 'retry-after': '90' }));
			await setTimeout(400);
			now = 20_000;
			controller.abort(deadline);
			await expect(outcome).resolves.toBe(deadline);
			expect(await readFile(foreignLock, 'utf8')).toBe('other owner');
		} finally {
			await unlink(foreignLock);
		}
		// A completion queued on this store observes the first completion's write.
		const schedule = await store.update(
			(schedules) => schedules.get(provider),
			'completion'
		);
		expect(schedule).toEqual({
			windowUntil: 70_000,
			requests: 1,
			active: 0,
			failures: 1,
			retryAt: 100_000
		});
		expect(request).toHaveBeenCalledTimes(1);
	});
});
