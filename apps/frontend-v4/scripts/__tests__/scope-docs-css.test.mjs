import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import { readFile } from 'node:fs/promises';
import { scopeDocsCss } from '../scope-docs-css.mjs';

const compile = async (css) =>
	(await postcss([scopeDocsCss()]).process(css, { from: undefined })).css;
test('utility and portal styles only activate while a docs wrapper exists', async () => {
	const css = await compile('.flex, [role="dialog"].dialog { display:flex }');
	assert.match(css, /:where\(body:has\(\.developer-docs\)\) \.flex/);
	assert.match(
		css,
		/:where\(body:has\(\.developer-docs\)\)\s+\[role="dialog"\]\.dialog/
	);
});
test('root tokens reach portals but root painting and element resets stay inside docs', async () => {
	const css = await compile(
		':root {--color-fd-background:white} body {background:white;color:black} button {font:inherit} * {border-color:red}'
	);
	assert.match(
		css,
		/:where\(body:has\(\.developer-docs\)\), :where\(\.developer-docs\) \{--color/
	);
	assert.match(
		css,
		/:where\(\.developer-docs\) \{background:white;color:black}/
	);
	assert.match(css, /:where\(\.developer-docs\) button/);
	assert.doesNotMatch(css, /body \{background/);
});
test('does not discard descendant targets when a selector references body', async () => {
	const css = await compile('body .target {color:red}');
	assert.match(css, /\.developer-docs \.target/);
});
test('preserves root dark conditions instead of applying dark tokens to light mode', async () => {
	const css = await compile(':root:is(.dark) {--color-fd-background:black}');
	assert.match(css, /developer-docs:is/);
	assert.match(css, /data-theme="dark"/);
	assert.doesNotMatch(
		css,
		/:where\(\.developer-docs\) \{--color-fd-background:black}/
	);
});
test('uses existing data-theme rather than taking over document classes', async () => {
	assert.match(
		await compile('.dark .panel {color:white}'),
		/data-theme="dark"/
	);
});
test('flattens only this compiled stylesheet and preserves nesting/media/keyframes', async () => {
	const css = await compile(
		'@layer utilities{.x{color:red;&:hover{color:blue}}}@media(min-width:1px){.y{display:flex}}@keyframes spin{from{opacity:0}to{opacity:1}}'
	);
	assert.doesNotMatch(css, /@layer/);
	assert.match(css, /&:hover/);
	assert.match(css, /@media/);
	assert.match(css, /from\{opacity:0}/);
	assert.doesNotMatch(css, /developer-docs[^}]+from/);
});
test('entry has explicit library sources, no Tailwind preflight, and no app-wide PostCSS configuration', async () => {
	const source = await readFile(
		new URL('../../src/components/docs/fumadocs.input.css', import.meta.url),
		'utf8'
	);
	assert.doesNotMatch(
		source,
		/@import ['"]tailwindcss['"]|tailwindcss\/preflight/
	);
	assert.match(source, /source\(none\)/);
	assert.match(
		source,
		/@source '\.\.\/\.\.\/\.\.\/node_modules\/fumadocs-ui\/dist'/
	);
});

test('namespaces keyframes without breaking custom animation variable references', async () => {
	const css = await compile(
		':root{--animate-pulse:pulse 2s ease-in-out infinite}.animate-pulse{animation:var(--animate-pulse)}@keyframes pulse{50%{opacity:.5}}'
	);
	assert.match(css, /@keyframes stellaratlas-docs-pulse/);
	assert.match(css, /--animate-pulse:stellaratlas-docs-pulse 2s/);
	assert.match(css, /animation:var\(--animate-pulse\)/);
	assert.doesNotMatch(css, /@keyframes pulse/);
});
