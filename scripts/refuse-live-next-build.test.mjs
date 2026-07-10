import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findLiveNextProcesses } from './refuse-live-next-build.mjs';

test('finds only Next processes serving the requested build directory', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'stellaratlas-next-build-'));
	const appDirectory = path.join(root, 'app');
	const procDirectory = path.join(root, 'proc');

	try {
		await mkdir(appDirectory);
		await createProcess(procDirectory, 101, appDirectory, '.next-production');
		await createProcess(procDirectory, 102, appDirectory, '.next-staging');
		await createProcess(procDirectory, 103, root, '.next-production');

		assert.deepEqual(
			await findLiveNextProcesses({
				appDirectory,
				distDirectory: '.next-production',
				procDirectory
			}),
			[101]
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

async function createProcess(procDirectory, pid, cwd, distDirectory) {
	const directory = path.join(procDirectory, String(pid));
	await mkdir(directory, { recursive: true });
	await symlink(cwd, path.join(directory, 'cwd'));
	await writeFile(path.join(directory, 'cmdline'), 'next-server\0');
	await writeFile(
		path.join(directory, 'environ'),
		`NEXT_DIST_DIR=${distDirectory}\0`
	);
}
