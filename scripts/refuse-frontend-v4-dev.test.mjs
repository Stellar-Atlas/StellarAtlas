import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
