import { describe, expect, it } from '@jest/globals';
import { Script } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { networkSseExample } from '../network-sse-example';
import { liveUpdatesGuide } from '../developer-guide-live-updates';

function harness() {
	const output: { kind: string; values: readonly unknown[] }[] = [];
	const sources: FakeEventSource[] = [];
	class FakeEventSource {
		readonly listeners = new Map<
			string,
			(event: Record<string, unknown>) => void
		>();
		closes = 0;
		constructor(readonly url: string) {
			sources.push(this);
		}
		addEventListener(
			name: string,
			listener: (event: Record<string, unknown>) => void
		) {
			this.listeners.set(name, listener);
		}
		close() {
			this.closes++;
		}
		send(name: string, data?: string) {
			this.listeners.get(name)?.(data === undefined ? {} : { data });
		}
	}
	const stop: () => void = new Script(
		'(function(){\n' + networkSseExample + '\nreturn stopNetworkUpdates;})()'
	).runInNewContext({
		EventSource: FakeEventSource,
		console: {
			log: (...values: unknown[]) => output.push({ kind: 'log', values }),
			error: (...values: unknown[]) => output.push({ kind: 'error', values })
		}
	});
	return { source: sources[0]!, sources, output, stop };
}

describe('network SSE guide example', () => {
	it('uses the implemented path and named network event without changing raw JSON bytes', () => {
		const h = harness(),
			json = '{"sequence":"9007199254740993","value":0.12345678901234567890}';
		expect(h.sources).toHaveLength(1);
		expect(h.source.url).toBe('https://api.stellaratlas.io/v1/live');
		h.source.send('message', json);
		expect(h.output).toEqual([]);
		h.source.send('network', json);
		expect(h.output).toEqual([
			{ kind: 'log', values: ['Network snapshot JSON:', json] }
		]);
	});
	it('treats a named server error as unavailable and closes before retry or later snapshots', () => {
		const h = harness();
		h.source.send('network', '{"saved":true}');
		h.source.send('error', '{"message":"Network snapshot unavailable"}');
		expect(h.source.closes).toBe(1);
		expect(h.output[1]).toEqual({
			kind: 'error',
			values: [
				'Network refresh unavailable; retain saved data:',
				'{"message":"Network snapshot unavailable"}'
			]
		});
		h.source.send('network', '{"late":true}');
		h.source.send('error');
		h.stop();
		expect(h.output).toHaveLength(2);
		expect(h.source.closes).toBe(1);
	});
	it('distinguishes a transport error without data from an empty network snapshot', () => {
		const h = harness();
		h.source.send('error');
		expect(h.output).toEqual([
			{
				kind: 'error',
				values: [
					'Network refresh unavailable; retain saved data:',
					'SSE connection interrupted'
				]
			}
		]);
		expect(h.source.closes).toBe(1);
	});
	it('cleans up idempotently without rendering late messages or errors', () => {
		const h = harness();
		h.stop();
		h.stop();
		h.source.send('network', '{}');
		h.source.send('error');
		expect(h.source.closes).toBe(1);
		expect(h.output).toEqual([]);
	});
	it('renders the same executable source and separate stream/coverage limits in the existing guide', () => {
		const section = liveUpdatesGuide.sections.find(
			(value) => value.id === 'network-sse'
		);
		if (!section) throw new Error('Missing SSE section');
		const html = renderToStaticMarkup(section.content);
		const encoded = renderToStaticMarkup(
			<code>{networkSseExample}</code>
		).slice(6, -7);
		expect(html).toContain(encoded);
		for (const text of [
			'/v1/live',
			'/v1/scp-statements/live',
			'scp-metadata',
			'HTTP 200',
			'HTTP 503',
			'not a failover replacement',
			'Last-Event-ID',
			'Browser HTTP CORS'
		])
			expect(html).toContain(text);
	});
});
