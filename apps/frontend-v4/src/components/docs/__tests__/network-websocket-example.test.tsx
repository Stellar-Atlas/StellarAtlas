import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { networkWebSocketExample } from '../network-websocket-example';
import { liveUpdatesGuide } from '../developer-guide-live-updates';
import { createNetworkWebSocketSession } from './fixtures/network-websocket-session';

function harness() {
	const output: { kind: string; values: readonly unknown[] }[] = [];
	const sockets: FakeSocket[] = [];
	class FakeSocket {
		onmessage?: (event: { data: unknown }) => void;
		onerror?: () => void;
		onclose?: () => void;
		closes = 0;
		constructor(readonly url: string) {
			sockets.push(this);
		}
		close() {
			this.closes++;
		}
		message(data: unknown) {
			this.onmessage?.({ data });
		}
	}
	const record =
		(kind: string) =>
		(...values: unknown[]) =>
			output.push({ kind, values });
	const stop = createNetworkWebSocketSession({
		WebSocket: FakeSocket,
		console: {
			log: record('log'),
			warn: record('warn'),
			error: record('error'),
			info: record('info')
		}
	});
	return { socket: sockets[0]!, sockets, output, stop };
}

describe('network/SCP WebSocket example', () => {
	it('selects summary and graph SCP through the URL without another connection', () => {
		const h = harness(),
			url = new URL(h.socket.url);
		expect(url.origin).toBe('wss://api.stellaratlas.io');
		expect(url.pathname).toBe('/v1/live/ws');
		expect(url.searchParams.get('channels')).toBe('summary,scp');
		expect(url.searchParams.get('scpMode')).toBe('graph');
		expect(url.searchParams.has('afterObservedAtMs')).toBe(false);
		expect(h.sockets).toHaveLength(1);
	});
	it('preserves string slot indices and original JSON tokens without reserialization', () => {
		const h = harness(),
			raw =
				'{"type":"scpGraph","payload":[{"slotIndex":"9007199254740993","values":[{"value":"18446744073709551615"}]}],"freshness":"fresh","truncated":false}';
		h.socket.message(raw);
		expect(h.output).toEqual([
			{ kind: 'log', values: ['Network/SCP message JSON:', raw] }
		]);
	});
	it('warns on truncation and stale metadata instead of implying complete fresh history', () => {
		const h = harness(),
			raw =
				'{"type":"scpGraph","payload":[],"freshness":"stale","truncated":true}';
		h.socket.message(raw);
		expect(h.output.map((item) => item.kind)).toEqual(['warn', 'warn', 'log']);
		expect(h.output[0]!.values[0]).toBe(
			'Bounded SCP update; do not infer complete history.'
		);
		expect(h.output[1]!.values[0]).toBe(
			'SCP observations are not fresh; inspect metadata.'
		);
		expect(h.output[2]!.values[1]).toBe(raw);
	});
	it('retains unavailable read errors within an otherwise open stream', () => {
		const h = harness(),
			raw =
				'{"type":"error","payload":{"message":"SCP statements unavailable"}}';
		h.socket.message(raw);
		expect(h.output).toEqual([
			{
				kind: 'error',
				values: ['Network/SCP read unavailable; retain saved data:', raw]
			}
		]);
		expect(h.socket.closes).toBe(0);
		h.socket.message('{"type":"heartbeat","payload":{}}');
		expect(h.output[1]!.kind).toBe('log');
	});
	it('terminates transport failure once and ignores all late callbacks', () => {
		const h = harness();
		h.socket.onerror?.();
		h.socket.onerror?.();
		h.socket.onclose?.();
		h.socket.message('{"type":"summary"}');
		h.stop();
		expect(h.socket.closes).toBe(1);
		expect(h.output).toHaveLength(1);
		expect(h.output[0]!.kind).toBe('error');
		expect(h.sockets).toHaveLength(1);
	});
	it('reports natural close once without manufacturing a reconnect', () => {
		const h = harness();
		h.socket.onclose?.();
		h.socket.onclose?.();
		h.stop();
		h.socket.message('{"type":"summary"}');
		expect(h.socket.closes).toBe(0);
		expect(h.output).toHaveLength(1);
		expect(h.output[0]!.kind).toBe('info');
		expect(h.sockets).toHaveLength(1);
	});
	it('cleans up idempotently before subsequent messages and callbacks', () => {
		const h = harness();
		h.stop();
		h.stop();
		h.socket.onclose?.();
		h.socket.onerror?.();
		h.socket.message('{"type":"summary"}');
		expect(h.socket.closes).toBe(1);
		expect(h.output).toEqual([]);
	});
	it('ignores malformed envelopes and the other stream protocols', () => {
		const h = harness();
		for (const data of [
			'{',
			'null',
			'[]',
			'true',
			'{}',
			'{"type":"scp"}',
			'{"version":1,"event":"datasets.published"}',
			new Uint8Array()
		])
			h.socket.message(data);
		expect(h.output).toEqual([]);
	});
	it('renders the unchanged shared example with explicit resume, Origin and source limits', () => {
		const section = liveUpdatesGuide.sections.find(
			(value) => value.id === 'network-websocket'
		);
		if (!section) throw new Error('Missing network WebSocket guide');
		const html = renderToStaticMarkup(section.content),
			encoded = renderToStaticMarkup(
				<code>{networkWebSocketExample}</code>
			).slice(6, -7);
		expect(html).toContain(encoded);
		for (const text of [
			'afterObservedAtMs',
			'afterStatementHash',
			'cursor affects SCP only',
			'scpMode=full',
			'HTTP 400',
			'application-level Origin allowlist',
			'not arbitrary historical replay',
			'Horizon fallback',
			'1013',
			'1011',
			'subscribeToLiveNetworkStream'
		])
			expect(html).toContain(text);
	});
});

const printer = ts.createPrinter({
	removeComments: true,
	newLine: ts.NewLineKind.LineFeed
});
function parse(source: string) {
	const file = ts.createSourceFile(
		'network.js',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	expect('parseDiagnostics' in file).toBe(true);
	if ('parseDiagnostics' in file) expect(file.parseDiagnostics).toEqual([]);
	return file;
}
function canonical(statements: readonly ts.Statement[], file: ts.SourceFile) {
	const result = ts.transform(ts.factory.createBlock(statements, true), [
		(context) => (root) => {
			const visit: ts.Visitor = (node) =>
				ts.isStringLiteral(node)
					? ts.factory.createStringLiteral(node.text)
					: ts.visitEachChild(node, visit, context);
			return ts.visitNode(root, visit, ts.isBlock)!;
		}
	]);
	try {
		return printer.printList(
			ts.ListFormat.MultiLine,
			result.transformed[0]!.statements,
			file
		);
	} finally {
		result.dispose();
	}
}
// Parse/print only. The imported typed fixture executes; displayed text never does.
function verifyParity(example: string) {
	const displayed = parse(example),
		actual = parse(createNetworkWebSocketSession.toString());
	expect(actual.statements).toHaveLength(1);
	const implementation = actual.statements[0]!;
	if (!ts.isFunctionDeclaration(implementation) || !implementation.body)
		throw new Error('Expected imported fixture');
	expect(
		implementation.parameters.map((parameter) => parameter.name.getText(actual))
	).toEqual(['environment']);
	const body = implementation.body.statements,
		binding = parse('const {WebSocket,console}=environment;'),
		control = parse('return stopNetworkSocket;');
	expect(canonical([body[0]!], actual)).toBe(
		canonical(binding.statements, binding)
	);
	expect(canonical([body[body.length - 1]!], actual)).toBe(
		canonical(control.statements, control)
	);
	expect(canonical(displayed.statements, displayed)).toBe(
		canonical(body.slice(1, -1), actual)
	);
}
it('keeps whole-body parity with the normally imported typed network fixture', () =>
	verifyParity(networkWebSocketExample));
it.each([
	networkWebSocketExample.replace('channels=summary,scp', 'channels=network'),
	networkWebSocketExample.replace('scpMode=graph', 'scpMode=full'),
	networkWebSocketExample.replace('networkSocket.close();', ''),
	networkWebSocketExample.replace('if (networkSocketStopped) return;', ''),
	networkWebSocketExample.replace('envelope.truncated === true', 'false'),
	networkWebSocketExample.replace("envelope.freshness !== 'fresh'", 'false'),
	networkWebSocketExample.replace('console.error', 'console.log')
])(
	'rejects executable/configuration drift without evaluating text %#',
	(example) => {
		expect(example).not.toBe(networkWebSocketExample);
		expect(() => verifyParity(example)).toThrow();
	}
);
