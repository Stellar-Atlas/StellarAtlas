import {
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	symlink
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { findLiveNextProcesses } from './refuse-live-next-build.mjs';

const slots = ['.next-slot-a', '.next-slot-b'];
const productionAlias = '.next-production';
const stagingAlias = '.next-staging';

export async function prepareStaging({
	appDirectory = process.cwd(),
	procDirectory = '/proc'
} = {}) {
	const appPath = await realpath(appDirectory);
	await refuseAliasProcess(appPath, stagingAlias, 'prepare staging', procDirectory);
	const productionSlot = await resolveFixedSlot(appPath, productionAlias);
	const stagingSlot = slots.find((slot) => slot !== productionSlot);
	const stagingPath = path.join(appPath, stagingSlot);

	await mkdir(stagingPath, { recursive: true });
	if ((await realpath(stagingPath)) !== stagingPath) {
		throw new Error(`${stagingSlot} must be a fixed directory`);
	}
	const liveSlotProcesses = await findLiveNextProcesses({
		appDirectory: appPath,
		distDirectory: stagingSlot,
		procDirectory
	});
	if (liveSlotProcesses.length > 0) {
		throw processError(`prepare staging on ${stagingSlot}`, liveSlotProcesses);
	}

	await rm(path.join(stagingPath, 'BUILD_ID'), { force: true });
	await repointAlias(appPath, stagingAlias, stagingSlot);
	return stagingSlot;
}

export async function promoteStaging({
	appDirectory = process.cwd(),
	procDirectory = '/proc'
} = {}) {
	const appPath = await realpath(appDirectory);
	await refuseAliasProcess(appPath, productionAlias, 'promote staging', procDirectory);
	const stagingSlot = await resolveFixedSlot(appPath, stagingAlias);
	const buildIdPath = path.join(appPath, stagingSlot, 'BUILD_ID');
	let buildId;

	try {
		if (!(await lstat(buildIdPath)).isFile()) throw new Error();
		buildId = (await readFile(buildIdPath, 'utf8')).trim();
	} catch {
		throw new Error(`Refusing to promote ${stagingSlot}: staging BUILD_ID is incomplete`);
	}
	if (!buildId) {
		throw new Error(`Refusing to promote ${stagingSlot}: staging BUILD_ID is incomplete`);
	}

	await repointAlias(appPath, productionAlias, stagingSlot);
	return { buildId, slot: stagingSlot };
}

async function refuseAliasProcess(appPath, alias, action, procDirectory) {
	const matches = await findLiveNextProcesses({
		appDirectory: appPath,
		distDirectory: alias,
		procDirectory,
		resolveAliases: false
	});
	if (matches.length > 0) throw processError(action, matches);
}

function processError(action, matches) {
	return new Error(
		`Refusing to ${action} while Next.js is active ` +
			`(process${matches.length === 1 ? '' : 'es'} ${matches.join(', ')})`
	);
}

async function resolveFixedSlot(appPath, alias) {
	let target;
	try {
		target = await realpath(path.join(appPath, alias));
	} catch {
		throw new Error(`${alias} must resolve to ${slots.join(' or ')}`);
	}
	const slot = slots.find((name) => target === path.join(appPath, name));
	if (!slot) throw new Error(`${alias} must resolve to ${slots.join(' or ')}`);
	return slot;
}

async function repointAlias(appPath, alias, slot) {
	const aliasPath = path.join(appPath, alias);
	try {
		if (!(await lstat(aliasPath)).isSymbolicLink()) {
			throw new Error(`${alias} must be a symbolic link`);
		}
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}

	const temporaryPath = `${aliasPath}.${process.pid}.${Date.now()}.tmp`;
	await symlink(slot, temporaryPath);
	try {
		await rename(temporaryPath, aliasPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

async function main() {
	if (process.argv[2] === 'prepare-staging') {
		process.stdout.write(`Prepared staging on ${await prepareStaging()}\n`);
		return;
	}
	if (process.argv[2] === 'promote-staging') {
		const release = await promoteStaging();
		process.stdout.write(`Promoted ${release.slot} (BUILD_ID ${release.buildId})\n`);
		return;
	}
	throw new Error('Expected prepare-staging or promote-staging');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}
