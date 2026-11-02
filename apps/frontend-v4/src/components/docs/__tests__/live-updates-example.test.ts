import { jest } from '@jest/globals';
import { createLiveUpdatesSession, type LiveUpdatesEnvironment } from './fixtures/live-updates-session';
import { contractEventExample } from '../../blockchain/contract-event-query';
import { contractActivityPath } from '../../../api/explorer-contract-activity';

const notice = {
	version: 1,
	event: 'datasets.published',
	batchId: '00000000-0000-4000-8000-000000000001',
	minLedger: Number(contractEventExample.min_ledger),
	maxLedger: Number(contractEventExample.max_ledger),
	datasets: ['history_contract_events']
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function harness() {
	const timers = new Map<number, { callback: () => unknown; delay: number }>();
	const output: { kind: string; values: unknown[] }[] = [];
	const reads: {
		url: string;
		signal: AbortSignal;
		response: ReturnType<
			typeof deferred<{
				ok: boolean;
				status: number;
				json: () => Promise<unknown>;
			}>
		>;
	}[] = [];
	const sockets: {
		url: string;
		closed: boolean;
		onmessage?: (event: { data: unknown }) => void;
		onclose?: () => void;
	}[] = [];
	let next = 0;
	const environment: LiveUpdatesEnvironment = {
		console: {
			log: (...values) => { output.push({ kind: 'log', values }); },
			error: (...values) => { output.push({ kind: 'error', values }); },
			info: (...values) => { output.push({ kind: 'info', values }); }
		},
		WebSocket: class {
			closed = false;
			constructor(readonly url: string) {
				sockets.push(this);
			}
			close() {
				this.closed = true;
			}
		},
		setTimeout(callback: () => unknown, delay: number) {
			const id = ++next;
			timers.set(id, { callback, delay });
			return id;
		},
		clearTimeout(id: number) {
			timers.delete(id);
		},
		fetch(url: string, options: { signal: AbortSignal }) {
			const response = deferred<{
				ok: boolean;
				status: number;
				json: () => Promise<unknown>;
			}>();
			reads.push({ url, signal: options.signal, response });
			return response.promise;
		}
	};
	const session = createLiveUpdatesSession(
		'https://api.stellaratlas.io' + contractActivityPath(contractEventExample.contract_id!, 'events', contractEventExample),
		Number(contractEventExample.min_ledger), Number(contractEventExample.max_ledger), environment
	);
	const socket = sockets[0]!;
	return {
		output,
		reads,
		timers,
		socket,
		sockets,
		send(value: unknown = notice) {
			socket.onmessage?.({ data: JSON.stringify(value) });
		},
		stop: session.stop,
		remembered: session.remembered,
		fire(delay: number) {
			const entry = [...timers].find(([, timer]) => timer.delay === delay);
			expect(entry).toBeDefined();
			timers.delete(entry![0]);
			return entry![1].callback();
		}
	};
}

const tick = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
const page = { rows: [{ id: '9007199254740993' }], nextCursor: null };

describe('published WebSocket refresh example lifecycle', () => {
	it('cancels queued work and ignores new notices after cleanup', () => {
		const h = harness();
		h.send();
		h.stop();
		h.send();
		h.socket.onclose?.();
		expect(h.reads).toHaveLength(0);
		expect(h.timers.size).toBe(0);
		expect(h.socket.closed).toBe(true);
		expect(h.output).toEqual([]);
	});

	it('does not read or publish a late fetch response after cleanup', async () => {
		const h = harness();
		h.send();
		const running = h.fire(250);
		h.stop();
		const json = jest.fn(async () => page);
		h.reads[0]!.response.resolve({ ok: true, status: 200, json });
		await running;
		expect(json).not.toHaveBeenCalled();
		expect(h.output).toEqual([]);
		expect(h.reads[0]!.signal.aborted).toBe(true);
		expect(h.timers.size).toBe(0);
	});

	it.each(['resolve', 'reject'] as const)(
		'suppresses late body %s after cleanup',
		async (mode) => {
			const h = harness(),
				body = deferred<unknown>();
			h.send();
			const running = h.fire(250);
			const json = jest.fn(() => body.promise);
			h.reads[0]!.response.resolve({ ok: true, status: 200, json });
			await tick();
			expect(json).toHaveBeenCalledTimes(1);
			h.stop();
			if (mode === 'resolve') body.resolve(page);
			else body.reject(new Error('Late body failure'));
			await running;
			expect(h.output).toEqual([]);
			expect(h.timers.size).toBe(0);
		}
	);

	it('suppresses intentional cleanup abort rejection and close output', async () => {
		const h = harness();
		h.send();
		const running = h.fire(250);
		h.stop();
		h.reads[0]!.response.reject(new Error('Synthetic abort'));
		h.socket.onclose?.();
		await running;
		expect(h.output).toEqual([]);
		expect(h.timers.size).toBe(0);
	});

	it.each(['network', 'http', 'body', 'deadline'] as const)(
		'retains active-session %s failures',
		async (mode) => {
			const h = harness();
			h.send();
			const running = h.fire(250),
				read = h.reads[0]!;
			if (mode === 'deadline') {
				h.fire(10_000);
				expect(read.signal.aborted).toBe(true);
			}
			if (mode === 'network' || mode === 'deadline')
				read.response.reject(new Error(mode));
			else
				read.response.resolve({
					ok: mode !== 'http',
					status: mode === 'http' ? 503 : 200,
					json: async () => {
						throw new Error('Body failure');
					}
				});
			await running;
			expect(h.output).toHaveLength(1);
			expect(h.output[0]!.kind).toBe('error');
			expect(h.output[0]!.values[0]).toBe(
				'Refresh failed; retain the previous page:'
			);
			expect(h.timers.size).toBe(0);
			expect(h.reads).toHaveLength(1);
		}
	);

	it('retains normal success, exact request filters and active close advice', async () => {
		const h = harness();
		h.send();
		const running = h.fire(250);
		h.reads[0]!.response.resolve({
			ok: true,
			status: 200,
			json: async () => page
		});
		await running;
		expect(h.output).toEqual([
			{ kind: 'log', values: ['Refreshed bounded event page:', page] }
		]);
		expect(h.reads[0]!.url).toBe(
			'https://api.stellaratlas.io' +
				contractActivityPath(
					contractEventExample.contract_id!,
					'events',
					contractEventExample
				)
		);
		expect(h.sockets).toHaveLength(1);
		expect(h.socket.url).toBe('wss://api.stellaratlas.io/v1/stream/data');
		h.socket.onclose?.();
		expect(h.output[1]!.kind).toBe('info');
		h.stop();
	});

	it('coalesces notices with one in-flight request and a bounded pending refresh', async () => {
		const h = harness();
		h.send();
		h.send();
		expect(h.timers.size).toBe(1);
		const first = h.fire(250);
		h.send({ ...notice, batchId: 'second' });
		h.send({ ...notice, batchId: 'third' });
		expect(h.reads).toHaveLength(1);
		expect([...h.timers.values()].map((t) => t.delay)).toEqual([10_000]);
		h.reads[0]!.response.resolve({
			ok: true,
			status: 200,
			json: async () => page
		});
		await first;
		expect([...h.timers.values()].map((t) => t.delay)).toEqual([250]);
		const second = h.fire(250);
		expect(h.reads).toHaveLength(2);
		h.stop();
		h.reads[1]!.response.reject(new Error('Cleanup'));
		await second;
		expect(h.timers.size).toBe(0);
		expect(h.output).toHaveLength(1);
	});

	it('does not reschedule pending work after cleanup', async () => {
		const h = harness();
		h.send();
		const running = h.fire(250);
		h.send({ ...notice, batchId: 'pending' });
		h.stop();
		h.reads[0]!.response.resolve({
			ok: true,
			status: 200,
			json: async () => page
		});
		await running;
		expect(h.timers.size).toBe(0);
		expect(h.reads).toHaveLength(1);
		expect(h.output).toEqual([]);
	});

	it.each([
		{ ...notice, version: 2 },
		{ ...notice, event: 'ready' },
		{ ...notice, datasets: ['history_transactions'] },
		{
			...notice,
			minLedger: Number(contractEventExample.max_ledger) + 1,
			maxLedger: Number(contractEventExample.max_ledger) + 2
		},
		{ ...notice, minLedger: 10, maxLedger: 9 }
	])('retains notice filtering %#', (value) => {
		const h = harness();
		h.send(value);
		expect(h.timers.size).toBe(0);
		h.stop();
	});

	it('retains the 256-entry deduplication bound', () => {
		const h = harness();
		for (let i = 0; i < 300; i++) h.send({ ...notice, batchId: String(i) });
		expect(h.remembered()).toBe(256);
		expect(h.timers.size).toBe(1);
		h.stop();
		expect(h.remembered()).toBe(0);
		expect(h.timers.size).toBe(0);
	});
});
