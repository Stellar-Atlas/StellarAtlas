import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findLiveNextProcesses } from './refuse-live-next-build.mjs';

test('finds Next processes whose resolved dist targets alias the requested target', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'stellaratlas-next-build-'));
	const appDirectory = path.join(root, 'app');
	const procDirectory = path.join(root, 'proc');

	try {
		await mkdir(appDirectory);
		await mkdir(path.join(appDirectory, '.next-slot-a'));
		await mkdir(path.join(appDirectory, '.next-slot-b'));
		await symlink('.next-slot-a', path.join(appDirectory, '.next-production'));
		await symlink('.next-slot-a', path.join(appDirectory, '.next-staging'));
		await createProcess(procDirectory, 101, appDirectory, '.next-production');
		await createProcess(procDirectory, 102, appDirectory, '.next-staging');
		await createProcess(procDirectory, 103, appDirectory, '.next-slot-a');
		await createProcess(procDirectory, 104, appDirectory, '.next-slot-b');
		await createProcess(procDirectory, 105, root, '.next-production');

		assert.deepEqual(
			await findLiveNextProcesses({
				appDirectory,
				distDirectory: '.next-staging',
				procDirectory
			}),
			[101, 102, 103]
		);
		assert.deepEqual(
			await findLiveNextProcesses({
				appDirectory,
				distDirectory: '.next-staging',
				procDirectory,
				resolveAliases: false
			}),
			[102]
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
