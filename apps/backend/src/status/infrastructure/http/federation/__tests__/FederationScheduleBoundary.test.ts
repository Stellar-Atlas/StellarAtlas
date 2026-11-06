import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
	recoverFederationSchedule,
	requireFederationScheduleDirectory,
	SharedFederationScheduleStore
} from '../SharedFederationScheduleStore.js';
import { fixtureDirectorySync } from './scheduleFixture.js';

const state = 'federation-schedule.json';
const lock = 'federation-schedule.lock';
const stage = 'federation-schedule.next';
const sync = fixtureDirectorySync ?? (async () => undefined);
const symlinkTest = process.platform === 'win32' ? it.skip : it;
const posixTest = process.getuid ? it : it.skip;
let root: string;
let directory: string;
let outside: string;
let replacement: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'atlas-federation-boundary-'));
	directory = join(root, 'schedule');
	outside = join(root, 'sentinel');
	replacement = join(root, 'replacement');
	await mkdir(directory, { mode: 0o700 });
	await writeFile(outside, '[]', { mode: 0o600 });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function update(path = directory) {
	const work = jest.fn(() => 'updated');
	const run = new SharedFederationScheduleStore(path, sync).update(work);
	return { run, work };
}

it('rejects relative and traversal spellings and requires a new recovery sibling', async () => {
	expect(() => new SharedFederationScheduleStore('relative', sync)).toThrow('absolute');
	await expect(recoverFederationSchedule('relative', replacement, true, sync))
		.rejects.toThrow('absolute');
	const traversal = directory + sep + '..' + sep + 'schedule';
	await expect(update(traversal).run).rejects.toThrow('canonical');
	await expect(recoverFederationSchedule(traversal, replacement, true, sync))
		.rejects.toThrow('canonical');
	await expect(recoverFederationSchedule(directory, join(directory, 'nested'), true, sync))
		.rejects.toThrow('new sibling');
	const traversalSibling = directory + sep + '..' + sep + 'replacement';
	await expect(recoverFederationSchedule(directory, traversalSibling, true, sync))
		.rejects.toThrow('new sibling');
});

symlinkTest('rejects both a symlinked directory and a symlinked ancestor in runtime and recovery', async () => {
	const alias = join(root, 'alias');
	await symlink(directory, alias, 'dir');
	const ancestor = join(root, 'ancestor');
	await symlink(root, ancestor, 'dir');
	for (const path of [alias, join(ancestor, 'schedule')]) {
		const { run, work } = update(path);
		await expect(run).rejects.toThrow('canonical');
		expect(work).not.toHaveBeenCalled();
		await expect(recoverFederationSchedule(path, replacement, true, sync))
			.rejects.toThrow('canonical');
	}
	await expect(readFile(outside, 'utf8')).resolves.toBe('[]');
});

symlinkTest.each([state, lock, stage])('never follows the %s symlink', async (leaf) => {
	await symlink(outside, join(directory, leaf));
	const { run, work } = update();
	await expect(run).rejects.toThrow('private ordinary files');
	expect(work).not.toHaveBeenCalled();
	if (leaf === state)
		await writeFile(join(directory, lock), '', { flag: 'wx', mode: 0o600 });
	await expect(recoverFederationSchedule(directory, replacement, true, sync))
		.rejects.toThrow(leaf === stage ? 'Uncertain' : 'private ordinary files');
	await expect(readFile(outside, 'utf8')).resolves.toBe('[]');
});

symlinkTest('refuses an existing symlink in place of the new recovery sibling', async () => {
	await writeFile(join(directory, lock), '', { mode: 0o600 });
	await writeFile(join(directory, state), '[]', { mode: 0o600 });
	await symlink(outside, replacement);
	await expect(recoverFederationSchedule(directory, replacement, true, sync))
		.rejects.toMatchObject({ code: 'EEXIST' });
	await expect(readFile(outside, 'utf8')).resolves.toBe('[]');
});

it('rejects hard-linked state and a directory in place of a lock', async () => {
	await link(outside, join(directory, state));
	const hardLink = update();
	await expect(hardLink.run).rejects.toThrow('private ordinary files');
	expect(hardLink.work).not.toHaveBeenCalled();
	await mkdir(join(directory, lock));
	const invalidLock = update();
	await expect(invalidLock.run).rejects.toThrow('private ordinary files');
	expect(invalidLock.work).not.toHaveBeenCalled();
	await expect(readFile(outside, 'utf8')).resolves.toBe('[]');
});

posixTest('rejects writable nonsticky ancestors, loose modes and the wrong owner', async () => {
	await chmod(root, 0o777);
	await expect(update().run).rejects.toThrow('trusted canonical parents');
	await expect(recoverFederationSchedule(directory, replacement, true, sync))
		.rejects.toThrow('trusted canonical parents');
	await chmod(root, 0o700);
	await chmod(directory, 0o750);
	await expect(update().run).rejects.toThrow('private canonical directory');
	await chmod(directory, 0o700);
	await writeFile(join(directory, state), '[]', { mode: 0o600 });
	await chmod(join(directory, state), 0o644);
	await expect(update().run).rejects.toThrow('private ordinary files');

	const uid = process.getuid!();
	const getuid = jest.spyOn(process, 'getuid').mockReturnValue(uid === 1 ? 2 : 1);
	try {
		await expect(requireFederationScheduleDirectory(root)).rejects.toThrow('owned by the API user');
	} finally {
		getuid.mockRestore();
	}
});
