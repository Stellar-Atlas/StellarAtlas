import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../explorer-contract-event-table.module.css', import.meta.url), 'utf8');
const rule = (name: string): string => {
	const body = new RegExp('\\.' + name + '\\s*\\{([^}]+)\\}').exec(css)?.[1];
	if (!body) throw new Error('Missing event table style: ' + name);
	return body;
};

it('anchors the hidden header within the scroll container without shrinking or hiding the table', () => {
	expect(rule('scroll')).toMatch(/position:\s*relative\s*;/);
	expect(rule('scroll')).toMatch(/overflow-x:\s*auto\s*;/);
	expect(rule('table')).toMatch(/min-width:\s*1060px\s*;/);
	expect(rule('srOnly')).toMatch(/position:\s*absolute\s*;/);
	expect(rule('srOnly')).not.toMatch(/display:\s*none|visibility:\s*hidden/);
});
