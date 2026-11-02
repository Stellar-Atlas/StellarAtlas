import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
import { recordFieldTree, recordTreeLimits, type RecordFieldLevel } from '../record-field-tree';
jest.unstable_mockModule('../explorer-record-fields.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ExplorerRecordFields } = await import('../explorer-record-fields');

describe('bounded readable source fields', () => {
	it('visits only explicitly expanded maps/lists and retains exact integer strings', () => {
		const value = { signers: [{ address: 'G' + 'A'.repeat(55), weight: '9007199254740993' }], paths: [], missing: null };
		const closed = recordFieldTree(value, new Set());
		expect(closed.nodes[0]?.count).toBe(1);
		expect(closed.nodes[0]?.children).toBeUndefined();
		const first = recordFieldTree(value, new Set([closed.nodes[0]!.path]));
		const signer = first.nodes[0]!.children!.nodes[0]!;
		const opened = recordFieldTree(value, new Set([closed.nodes[0]!.path, signer.path]));
		expect(opened.nodes[0]!.children!.nodes[0]!.children!.nodes[1]!.value).toBe('9007199254740993');
		expect(closed.nodes[1]?.count).toBe(0);
		expect(closed.nodes[2]?.count).toBeNull();
	});
	it('bounds rows, total visible nodes and depth even for pathological nested values', () => {
		const value = Object.fromEntries(Array.from({ length: 35 }, (_, i) => ['field_' + i, { children: Array.from({ length: 35 }, () => ({ next: { last: { deep: ['raw only'] } } })) }]));
		const expanded = new Set<string>();
		const count = (level: RecordFieldLevel): number => level.nodes.reduce((sum, node) => {
			if (node.expandable) expanded.add(node.path);
			return sum + 1 + (node.children ? count(node.children) : 0);
		}, 0);
		for (let i = 0; i < 8; i++) expect(count(recordFieldTree(value, expanded))).toBeLessThanOrEqual(recordTreeLimits.nodes);
		expect(recordFieldTree(value, new Set()).nodes).toHaveLength(recordTreeLimits.rows);
		expect(recordFieldTree(value, new Set()).omitted).toBe(15);
		const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
		for (let i = 0; i < 8; i++) count(recordFieldTree(cyclic, expanded));
		expect(count(recordFieldTree(cyclic, expanded))).toBeLessThan(10);
	});
	it('escapes unknown text, links exact references and keeps nested/raw content collapsed initially', () => {
		const html = renderToStaticMarkup(createElement(ExplorerRecordFields, {
			value: { note: '<script>alert(1)</script>', account: 'G' + 'A'.repeat(55), signers: [{ weight: '9223372036854775807' }], missing: null }, filters: {}
		}));
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('/explorer/accounts/G' + 'A'.repeat(55));
		expect(html).toContain('aria-label="Expand signers"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('Raw details');
		expect(html).toContain('Not recorded');
		expect(html).not.toContain('9223372036854775807');
		expect(html).not.toContain('<pre');
	});
});
