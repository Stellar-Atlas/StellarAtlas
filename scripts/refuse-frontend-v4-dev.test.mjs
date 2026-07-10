import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('frontend-v4 development mode is disabled', () => {
	const result = spawnSync(process.execPath, ['scripts/refuse-frontend-v4-dev.mjs'], {
		cwd: process.cwd(),
		encoding: 'utf8'
	});

	assert.equal(result.status, 1);
	assert.match(result.stderr, /development mode is disabled/);
	assert.match(result.stderr, /build:staging/);
});

test('frontend-v4 type generation never writes to production output', () => {
	const packageJson = JSON.parse(
		readFileSync('apps/frontend-v4/package.json', 'utf8')
	);

	assert.match(packageJson.scripts.typecheck, /^NEXT_DIST_DIR=.next-staging /);
});
