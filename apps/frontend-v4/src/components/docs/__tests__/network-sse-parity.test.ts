import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';
import { networkSseExample } from '../network-sse-example';
import { createNetworkSseSession } from './fixtures/network-sse-session';

const printer = ts.createPrinter({
	removeComments: true,
	newLine: ts.NewLineKind.LineFeed
});
function parse(source: string) {
	const file = ts.createSourceFile(
		'network-example.js',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	expect('parseDiagnostics' in file).toBe(true);
	if ('parseDiagnostics' in file) expect(file.parseDiagnostics).toEqual([]);
	return file;
}
// Parsing and printing only; documentation text is never executed or loaded as a module.
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
function verifyParity(example: string) {
	const displayed = parse(example),
		actual = parse(createNetworkSseSession.toString());
	expect(actual.statements).toHaveLength(1);
	const implementation = actual.statements[0]!;
	if (!ts.isFunctionDeclaration(implementation) || !implementation.body)
		throw new Error('Expected imported fixture function');
	expect(
		implementation.parameters.map((parameter) => parameter.name.getText(actual))
	).toEqual(['environment']);
	const body = implementation.body.statements;
	const binding = parse('const { EventSource, console } = environment;'),
		control = parse('return stopNetworkUpdates;');
	expect(canonical([body[0]!], actual)).toBe(
		canonical(binding.statements, binding)
	);
	expect(canonical([body[body.length - 1]!], actual)).toBe(
		canonical(control.statements, control)
	);
	// Exclude exactly the verified dependency binding and returned cleanup handle.
	expect(canonical(displayed.statements, displayed)).toBe(
		canonical(body.slice(1, -1), actual)
	);
}

describe('network SSE whole-body parity', () => {
	it('matches the complete normally imported lifecycle including fixed URL and event names', () =>
		verifyParity(networkSseExample));
	it.each([
		networkSseExample.replace("'network'", "'message'"),
		networkSseExample.replace("'error'", "'message'"),
		networkSseExample.replace('networkEvents.close();', ''),
		networkSseExample.replace('if (networkUpdatesStopped) return;', ''),
		networkSseExample.replace("'data' in event", 'false'),
		networkSseExample.replace('console.error', 'console.log'),
		networkSseExample.replace('/v1/live', '/v1/other')
	])('rejects lifecycle or configuration drift %#', (example) => {
		expect(example).not.toBe(networkSseExample);
		expect(() => verifyParity(example)).toThrow();
	});
});
