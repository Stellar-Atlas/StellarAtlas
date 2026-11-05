import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { PHASE_PRODUCTION_BUILD } = require('next/constants');
const loadConfig = require('next/dist/server/config').default;
const { generateBuildId } = require('next/dist/build/generate-build-id');
const { writeBuildId } = require('next/dist/build/write-build-id');
const { nanoid } = require('next/dist/compiled/nanoid/index.cjs');
const project = fileURLToPath(new URL('../../', import.meta.url));

test('distinct artifacts from the same deployment have distinct native build IDs', async () => {
	const original = process.env.NEXT_DEPLOYMENT_ID;
	process.env.NEXT_DEPLOYMENT_ID = 'same-source-revision';
	try {
		const config = await loadConfig(PHASE_PRODUCTION_BUILD, project);
		assert.equal(config.deploymentId, 'same-source-revision');
		assert.equal(typeof config.generateBuildId, 'function');
		const build = () => generateBuildId(config.generateBuildId, nanoid);
		const first = await build();
		const second = await build();
		assert.notEqual(first, second);
		for (const id of [first, second]) {
			assert.notEqual(id, 'build-TfctsWXpff2fKS');
			assert.match(id, /^[A-Za-z0-9_-]+$/);
			assert.doesNotMatch(id, /ad/i);
		}
		const scratch = await mkdtemp(join(tmpdir(), 'atlas-build-id-'));
		try {
			const artifact = join(scratch, 'artifact'), replica = join(scratch, 'replica');
			await mkdir(artifact);
			await mkdir(replica);
			await writeBuildId(artifact, first);
			await copyFile(join(artifact, 'BUILD_ID'), join(replica, 'BUILD_ID'));
			assert.equal(await readFile(join(replica, 'BUILD_ID'), 'utf8'), first);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	} finally {
		if (original === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
		else process.env.NEXT_DEPLOYMENT_ID = original;
	}
});

test('ordinary local builds retain the native fallback without an extra identity input', async () => {
	const { default: config } = await import('../../next.config.ts');
	assert.equal(await generateBuildId(config.generateBuildId, () => 'local-fallback'), 'local-fallback');
});
