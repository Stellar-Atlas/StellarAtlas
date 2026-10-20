import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backendRequire = createRequire(
	new URL('../apps/backend/package.json', import.meta.url)
);
const usersRequire = createRequire(
	new URL('../apps/users/package.json', import.meta.url)
);
const httpHelperRequire = createRequire(
	new URL('../packages/http-helper/package.json', import.meta.url)
);
const frontendRequire = createRequire(
	new URL('../apps/frontend-v4/package.json', import.meta.url)
);
const sharedRequire = createRequire(
	new URL('../packages/shared/package.json', import.meta.url)
);
const rootRequire = createRequire(new URL('../package.json', import.meta.url));
const schemaRequire = createRequire(
	sharedRequire.resolve('typescript-json-schema')
);
const ajvRequire = createRequire(backendRequire.resolve('ajv'));
const expressRequire = createRequire(backendRequire.resolve('express'));
const tsJestRequire = createRequire(rootRequire.resolve('ts-jest'));
const concurrentlyRequire = createRequire(rootRequire.resolve('concurrently'));
const toml = backendRequire('toml');
const { VM, NodeVM } = schemaRequire('vm2');
const proxyAddr = expressRequire('proxy-addr');
const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');

function assertDependencyVersionAtLeast(requireFrom, dependency, minimum) {
	assertVersionAtLeast(
		requireFrom(`${dependency}/package.json`).version,
		minimum
	);
}

function assertVersionAtLeast(actual, minimum) {
	const parts = actual.split('.').map(Number);
	assert.equal(parts.length, 3, 'Expected a stable three-part release');
	assert.ok(parts.every(Number.isSafeInteger), 'Do not accept prereleases');
	const expected = minimum.split('.').map(Number);
	const differing = parts.findIndex((part, index) => part !== expected[index]);
	assert.ok(
		differing < 0 || parts[differing] > expected[differing],
		`${actual} must be at least ${minimum}`
	);
}

async function assertInstalledPackageFloors(packageName, minimumForVersion) {
	const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const matches = [...lockfile.matchAll(new RegExp(`^  ${escapedName}@([0-9]+\\.[0-9]+\\.[0-9]+)(?:\\([^\\n:]*\\))?:`, 'gm'))];
	assert.ok(matches.length > 0, `${packageName} must be present in the lockfile`);
	for (const match of matches) {
		const version = match[1].split('(')[0];
		const minimum = minimumForVersion(version);
		if (minimum) assertVersionAtLeast(version, minimum);
	}
}

test('effective runtime and schema-tool versions contain the reviewed fixes', async () => {
	assertVersionAtLeast(backendRequire('toml/package.json').version, '4.2.0');
	assertVersionAtLeast(schemaRequire('vm2/package.json').version, '3.12.2');
	assertVersionAtLeast(ajvRequire('fast-uri/package.json').version, '3.1.8');
	assertVersionAtLeast(frontendRequire('next/package.json').version, '16.4.2');
	assertVersionAtLeast(expressRequire('proxy-addr/package.json').version, '2.0.8');
	assertVersionAtLeast(tsJestRequire('handlebars/package.json').version, '4.7.10');
	assertVersionAtLeast(concurrentlyRequire('shell-quote/package.json').version, '1.12.0');
	assertDependencyVersionAtLeast(backendRequire, 'axios', '1.20.0');
	assertDependencyVersionAtLeast(usersRequire, 'axios', '1.20.0');
	assertDependencyVersionAtLeast(httpHelperRequire, 'axios', '1.20.0');
	assertDependencyVersionAtLeast(backendRequire, 'nodemailer', '10.0.9');
	assertDependencyVersionAtLeast(backendRequire, 'moment', '2.31.0');
	await assertInstalledPackageFloors('brace-expansion', (version) => {
		const major = Number(version.split('.')[0]);
		return major === 1 ? '1.1.21' : major === 2 ? '2.1.7' : major === 5 ? '5.0.12' : null;
	});
	await assertInstalledPackageFloors('js-yaml', (version) =>
		version.startsWith('3.') ? '3.15.2' : null
	);
	await assertInstalledPackageFloors('smol-toml', () => '1.9.0');
	await assertInstalledPackageFloors('source-map-js', () => '1.2.2');
	await assertInstalledPackageFloors('postcss-selector-parser', () => '7.1.6');
	await assertInstalledPackageFloors('markdown-it', () => '14.3.3');
	await assertInstalledPackageFloors('follow-redirects', () => '1.16.1');
	await assertInstalledPackageFloors('vite', (version) =>
		version.startsWith('6.') ? '6.4.4' : null
	);
});

test('proxy-addr normalizes IPv4-mapped IPv6 addresses for trusted ranges', () => {
	const loopback = proxyAddr.compile('127.0.0.1/32');
	assert.equal(loopback('::ffff:127.0.0.1'), true);
	assert.equal(loopback('::ffff:127.0.0.2'), false);

	const privateNetwork = proxyAddr.compile('10.0.0.0/8');
	assert.equal(privateNetwork('::ffff:10.1.2.3'), true);
	assert.equal(privateNetwork('::ffff:11.1.2.3'), false);
});

test('the schema sandbox remains usable without exposing dangerous host builtins', () => {
	assert.equal(new VM().run('1 + 2'), 3);
	for (const builtin of ['os', 'dns', 'dns/promises']) {
		const vm = new NodeVM({
			console: 'off',
			require: { external: false, builtin: ['*'] }
		});
		assert.throws(() => vm.run(`module.exports = require('${builtin}')`));
	}
});

test('TOML parsing preserves expected validator and organization metadata', () => {
	const parsed = toml.parse(
		'[DOCUMENTATION]\nORG_NAME = "Example"\n' +
			'[[VALIDATORS]]\nALIAS = "validator-01"\n' +
			'HISTORY = "https://archive.example/history"\n'
	);
	assert.equal(parsed.DOCUMENTATION.ORG_NAME, 'Example');
	assert.equal(parsed.VALIDATORS[0].ALIAS, 'validator-01');
	assert.equal(parsed.VALIDATORS[0].HISTORY, 'https://archive.example/history');
});

test('TOML input cannot write a prototype property', () => {
	assert.equal(Object.prototype.archiveSecurityProbe, undefined);
	try {
		toml.parse('[__proto__]\narchiveSecurityProbe = true\n');
	} catch (error) {
		assert.equal(error.name, 'SyntaxError');
	}
	assert.equal(Object.prototype.archiveSecurityProbe, undefined);
});

test('deep TOML arrays hit the parser depth limit rather than stack exhaustion', () => {
	assert.throws(
		() => toml.parse('value = ' + '['.repeat(2_000) + '0' + ']'.repeat(2_000)),
		(error) =>
			error instanceof Error &&
			!(error instanceof RangeError) &&
			/Maximum nesting depth of 500 exceeded/.test(error.message)
	);
});
