import assert from 'node:assert/strict';
import {
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareStaging, promoteStaging } from './frontend-v4-release.mjs';

test('prepares the fixed slot not served by production', async () => {
	await withFixture(async ({ appDirectory, procDirectory }) => {
		await createProcess(procDirectory, 101, appDirectory, '.next-production');
		await writeFile(path.join(appDirectory, '.next-slot-a', 'BUILD_ID'), 'stale');
		await writeFile(path.join(appDirectory, '.next-slot-b', 'BUILD_ID'), 'production-b');

		assert.equal(await prepareStaging({ appDirectory, procDirectory }), '.next-slot-a');
		assert.equal(await readlink(path.join(appDirectory, '.next-staging')), '.next-slot-a');
		assert.equal(await readlink(path.join(appDirectory, '.next-production')), '.next-slot-b');
		assert.equal(
			await readFile(path.join(appDirectory, '.next-slot-b', 'BUILD_ID'), 'utf8'),
			'production-b'
		);
		await assert.rejects(
			readFile(path.join(appDirectory, '.next-slot-a', 'BUILD_ID')),
			{ code: 'ENOENT' }
		);
	});
});

test('refuses staging preparation while staging Next is active', async () => {
	await withFixture(async ({ appDirectory, procDirectory }) => {
		await createProcess(procDirectory, 102, appDirectory, '.next-staging');

		await assert.rejects(
			prepareStaging({ appDirectory, procDirectory }),
			/Refusing to prepare staging.*102/
		);
		assert.equal(await readlink(path.join(appDirectory, '.next-staging')), '.next-slot-b');
	});
});

test('promotes only a complete staging build while production is stopped', async () => {
	await withFixture(async ({ appDirectory, procDirectory }) => {
		await rm(path.join(appDirectory, '.next-staging'));
		await symlink('.next-slot-a', path.join(appDirectory, '.next-staging'));
		await writeFile(path.join(appDirectory, '.next-slot-a', 'BUILD_ID'), 'release-a\n');

		assert.deepEqual(await promoteStaging({ appDirectory, procDirectory }), {
			buildId: 'release-a',
			slot: '.next-slot-a'
		});
		assert.equal(await readlink(path.join(appDirectory, '.next-production')), '.next-slot-a');
	});
});

test('refuses promotion with active production or an incomplete BUILD_ID', async () => {
	await withFixture(async ({ appDirectory, procDirectory }) => {
		await rm(path.join(appDirectory, '.next-staging'));
		await symlink('.next-slot-a', path.join(appDirectory, '.next-staging'));
		await createProcess(procDirectory, 103, appDirectory, '.next-production');

		await assert.rejects(
			promoteStaging({ appDirectory, procDirectory }),
			/Refusing to promote staging.*103/
		);
		await rm(path.join(procDirectory, '103'), { recursive: true });
		await assert.rejects(
			promoteStaging({ appDirectory, procDirectory }),
			/staging BUILD_ID is incomplete/
		);
		assert.equal(await readlink(path.join(appDirectory, '.next-production')), '.next-slot-b');
	});
});

async function withFixture(run) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'stellaratlas-release-'));
	const appDirectory = path.join(root, 'app');
	const procDirectory = path.join(root, 'proc');
	try {
		await mkdir(path.join(appDirectory, '.next-slot-a'), { recursive: true });
		await mkdir(path.join(appDirectory, '.next-slot-b'));
		await mkdir(procDirectory);
		await symlink('.next-slot-b', path.join(appDirectory, '.next-production'));
		await symlink('.next-slot-b', path.join(appDirectory, '.next-staging'));
		await run({ appDirectory, procDirectory });
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}

async function createProcess(procDirectory, pid, cwd, distDirectory) {
	const directory = path.join(procDirectory, String(pid));
	await mkdir(directory, { recursive: true });
	await symlink(cwd, path.join(directory, 'cwd'));
	await writeFile(path.join(directory, 'cmdline'), 'next-server\0');
	await writeFile(path.join(directory, 'environ'), `NEXT_DIST_DIR=${distDirectory}\0`);
}
