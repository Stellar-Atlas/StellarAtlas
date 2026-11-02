import { afterEach, describe, expect, it } from '@jest/globals';
import {
	eventPage,
	eventUrl,
	publication,
	settle,
	until,
	wireFixture
} from './fixtures/live-updates-wire';

const active: Awaited<ReturnType<typeof wireFixture>>[] = [];
async function fixture() {
	const value = await wireFixture();
	active.push(value);
	return value;
}
afterEach(async () => {
	for (const value of active.splice(0)) await value.close();
});

describe('exact published example over bounded loopback WebSocket and HTTP', () => {
	it('accepts first ready without subscribing or reading, and handles wire ping/pong without a notice', async () => {
		const h = await fixture();
		h.start();
		await until(() => h.frames.length === 1, 'ready');
		expect(h.frames[0]?.data).toBe('{"version":1,"event":"ready"}');
		h.ping();
		await until(() => h.stats().pongs === 1, 'automatic pong');
		await settle();
		expect(h.frames).toHaveLength(1);
		expect(h.reads).toHaveLength(0);
		expect(h.messages).toHaveLength(0);
	});
	it('executes the copied text, preserves exact URL filters, ignores duplicates and malformed/unrelated frames', async () => {
		const h = await fixture();
		const session = h.start();
		await until(() => h.frames.length === 1, 'ready');
		h.sendRaw('{bad');
		h.sendRaw('x'.repeat(4097));
		h.sendRaw(Buffer.from(JSON.stringify(publication())));
		h.send({ version: 1, event: 'heartbeat' });
		h.send({ ...publication(), datasets: ['history_transactions'] });
		h.send({ ...publication(), minLedger: 1, maxLedger: 2 });
		h.send();
		h.send();
		await until(
			() => h.outputs.some((item) => item.kind === 'log'),
			'bounded read'
		);
		h.send();
		await settle();
		expect(h.reads).toHaveLength(1);
		expect(session.remembered()).toBe(1);
		expect(h.reads[0]).toMatchObject({
			url: eventUrl,
			method: 'GET',
			cookie: false,
			authorization: false
		});
		expect(h.outputs.find((item) => item.kind === 'log')?.values).toEqual([
			'Refreshed bounded event page:',
			eventPage
		]);
		expect(h.failures).toHaveLength(0);
	});
	it('keeps one real HTTP request in flight and coalesces a pending publication burst', async () => {
		const h = await fixture();
		h.setMode('hold');
		h.start();
		await until(() => h.frames.length === 1, 'ready');
		h.send();
		await until(() => h.reads.length === 1, 'held read');
		h.send(publication(2));
		h.send(publication(3));
		await settle();
		expect(h.reads).toHaveLength(1);
		h.setMode('success');
		h.release();
		await until(
			() => h.outputs.filter((item) => item.kind === 'log').length === 2,
			'two bounded responses'
		);
		expect(h.reads).toHaveLength(2);
		expect(h.stats().maximumActive).toBe(1);
	});
	it.each(['http', 'body'] as const)(
		'retains %s failure without automatic retry, then accepts a new notice',
		async (mode) => {
			const h = await fixture();
			h.setMode(mode);
			h.start();
			await until(() => h.frames.length === 1, 'ready');
			h.send();
			await until(
				() => h.outputs.some((item) => item.kind === 'error'),
				'read failure'
			);
			h.send();
			await settle();
			expect(h.reads).toHaveLength(1);
			expect(h.outputs[0]?.values[0]).toBe(
				'Refresh failed; retain the previous page:'
			);
			h.setMode('success');
			h.send(publication(2));
			await until(
				() => h.outputs.some((item) => item.kind === 'log'),
				'new publication read'
			);
			expect(h.reads).toHaveLength(2);
		}
	);
	it('reports 1013 disconnect, never silently reconnects/replays, and permits an explicit fresh session/catch-up', async () => {
		const h = await fixture();
		const first = h.start();
		await until(() => h.frames.length === 1, 'ready');
		h.send();
		await until(() => h.reads.length === 1, 'first publication');
		await until(
			() => h.outputs.some((item) => item.kind === 'log'),
			'first read'
		);
		h.closeFeed();
		await until(
			() => h.outputs.some((item) => item.kind === 'info'),
			'close advice'
		);
		await settle(1100);
		expect(h.stats().upgrades).toBe(1);
		expect(h.reads).toHaveLength(1);
		first.stop();
		h.send(publication(2));
		h.start();
		await until(
			() =>
				h.stats().upgrades === 2 &&
				h.frames.filter((item) => item.session === 1).length === 1,
			'new ready'
		);
		await settle();
		expect(h.reads).toHaveLength(1);
		const catchUp = await h.catchUp();
		expect(await catchUp.json()).toEqual(eventPage);
		h.send();
		await until(() => h.reads.length === 3, 'new session dedup scope');
		expect(h.outputs.find((item) => item.kind === 'info')?.values[0]).toContain(
			'recheck coverage'
		);
		expect(h.messages).toHaveLength(0);
	});
	it('cancels queued refresh work and closes the real connection during cleanup', async () => {
		const h = await fixture();
		const session = h.start();
		await until(() => h.frames.length === 1, 'ready');
		h.send();
		await until(() => h.frames.length === 2, 'publication frame');
		session.stop();
		await until(() => h.clients[0]?.readyState === 3, 'client close');
		await settle();
		expect(h.reads).toHaveLength(0);
		expect(h.outputs).toHaveLength(0);
		expect(h.timers.size).toBe(0);
	});
	it('aborts real in-flight response-body reading and drops pending work after cleanup', async () => {
		const h = await fixture();
		h.setMode('slow-body');
		const session = h.start();
		await until(() => h.frames.length === 1, 'ready');
		h.send();
		await until(() => h.reads.length === 1, 'body read');
		h.send(publication(2));
		await until(() => h.frames.length === 3, 'pending frame');
		session.stop();
		await until(() => h.reads[0]?.aborted === true, 'body socket abort');
		await settle();
		expect(h.reads).toHaveLength(1);
		expect(h.outputs).toHaveLength(0);
		expect(h.timers.size).toBe(0);
	});
	it('handles a rejected handshake as close advice without retrying or reading data', async () => {
		const h = await fixture();
		h.setRejectUpgrade();
		h.start();
		await until(
			() => h.outputs.some((item) => item.kind === 'info'),
			'rejected close'
		);
		await settle();
		expect(h.stats().upgrades).toBe(1);
		expect(h.reads).toHaveLength(0);
		expect(h.failures).toHaveLength(1);
	});
});
