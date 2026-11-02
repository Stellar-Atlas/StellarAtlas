import ts from 'typescript';
import { liveUpdatesExample } from '../live-updates-example';
import { contractEventExample } from '../../blockchain/contract-event-query';
import { contractActivityPath } from '../../../api/explorer-contract-activity';
import { createLiveUpdatesSession } from './fixtures/live-updates-session';

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const eventUrl = 'https://api.stellaratlas.io' + contractActivityPath(contractEventExample.contract_id!, 'events', contractEventExample);

function parse(source: string) {
	const file = ts.createSourceFile('example.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	expect('parseDiagnostics' in file).toBe(true);
	if ('parseDiagnostics' in file) expect(file.parseDiagnostics).toEqual([]);
	return file;
}

/** Parse/print only: no VM, eval, Function constructor, loader or execution of example text. */
function canonical(statements: readonly ts.Statement[], file: ts.SourceFile, displayedBounds = false) {
	let bounds = 0;
	const result = ts.transform(ts.factory.createBlock(statements, true), [context => root => {
		const visit: ts.Visitor = node => {
			if (displayedBounds && ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) &&
				ts.isIdentifier(node.left.expression) && node.left.expression.text === 'notice' && ts.isNumericLiteral(node.right)) {
				const minimum = node.left.name.text === 'maxLedger' && node.operatorToken.kind === ts.SyntaxKind.LessThanToken && Number(node.right.text) === Number(contractEventExample.min_ledger);
				const maximum = node.left.name.text === 'minLedger' && node.operatorToken.kind === ts.SyntaxKind.GreaterThanToken && Number(node.right.text) === Number(contractEventExample.max_ledger);
				if (minimum || maximum) {
					bounds++;
					return ts.factory.updateBinaryExpression(node, node.left, node.operatorToken, ts.factory.createIdentifier(minimum ? 'minLedger' : 'maxLedger'));
				}
			}
			// Only literal spelling/whitespace/comments normalize; values and statement order remain.
			if (ts.isNumericLiteral(node)) {
				const value = Number(node.text);
				expect(Number.isSafeInteger(value)).toBe(true);
				return ts.factory.createNumericLiteral(value);
			}
			if (ts.isStringLiteral(node)) return ts.factory.createStringLiteral(node.text);
			return ts.visitEachChild(node, visit, context);
		};
		return ts.visitNode(root, visit, ts.isBlock)!;
	}]);
	try {
		expect(bounds).toBe(displayedBounds ? 2 : 0);
		return printer.printList(ts.ListFormat.MultiLine, result.transformed[0]!.statements, file);
	} finally { result.dispose(); }
}

function verifyParity(example: string) {
	const displayed = parse(example), actual = parse(createLiveUpdatesSession.toString());
	expect(actual.statements).toHaveLength(1);
	const implementation = actual.statements[0]!;
	if (!ts.isFunctionDeclaration(implementation) || !implementation.body) throw new Error('Expected imported example function');
	expect(implementation.parameters.map(parameter => parameter.name.getText(actual))).toEqual(['eventUrl', 'minLedger', 'maxLedger', 'environment']);
	const body = implementation.body.statements;
	const environment = parse('const { WebSocket, setTimeout, clearTimeout, fetch, console } = environment;');
	const controls = parse('return { stop: stopUpdates, remembered: () => seen.size };');
	expect(canonical([body[0]!], actual)).toBe(canonical(environment.statements, environment));
	expect(canonical([body[body.length - 1]!], actual)).toBe(canonical(controls.statements, controls));
	const first = displayed.statements[0]!;
	if (!ts.isVariableStatement(first) || !(first.declarationList.flags & ts.NodeFlags.Const)) throw new Error('Expected fixed event URL');
	expect(first.declarationList.declarations).toHaveLength(1);
	const declaration = first.declarationList.declarations[0]!;
	expect(declaration.name.getText(displayed)).toBe('eventUrl');
	if (!declaration.initializer || !ts.isStringLiteral(declaration.initializer)) throw new Error('Expected literal event URL');
	expect(declaration.initializer.text).toBe(eventUrl);
	// Exclude exactly the validated data declaration, dependency binding and inspection return.
	expect(canonical(displayed.statements.slice(1), displayed, true)).toBe(canonical(body.slice(1, -1), actual));
}

it('keeps the complete displayed lifecycle body equivalent to the normally imported executable fixture', () => {
	verifyParity(liveUpdatesExample);
});

it.each([
	liveUpdatesExample.replace('if (stopped) return;', ''),
	liveUpdatesExample.replace('}, 250);', '}, 251);'),
	liveUpdatesExample.replace('seen.size > 256', 'seen.size > 257'),
	liveUpdatesExample.replace("'history_contract_events'", "'history_transactions'"),
	liveUpdatesExample.replace('notice.maxLedger < ', 'notice.maxLedger <= '),
	liveUpdatesExample.replace('https://api.stellaratlas.io', 'https://outside.invalid')
])('rejects behavioral or configuration drift in the displayed example %#', example => {
	expect(example).not.toBe(liveUpdatesExample);
	expect(() => verifyParity(example)).toThrow();
});
