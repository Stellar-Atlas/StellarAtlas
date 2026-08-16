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
	aliasRepoint = repointAlias,
	appDirectory = process.cwd(),
	procDirectory = '/proc'
} = {}) {
	const appPath = await realpath(appDirectory);
	await refuseAliasProcess(
		appPath,
		stagingAlias,
		'prepare staging',
		procDirectory
	);
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
	await aliasRepoint(appPath, stagingAlias, stagingSlot);
	return stagingSlot;
}

export async function promoteStaging({
	aliasRepoint = repointAlias,
	appDirectory = process.cwd(),
	procDirectory = '/proc',
	onRollbackCaptured
} = {}) {
	const appPath = await realpath(appDirectory);
	await refuseAliasProcess(
		appPath,
		productionAlias,
		'promote staging',
		procDirectory
	);
	const rollback = await captureProductionRollback(appPath);
	const stagingSlot = await resolveFixedSlot(appPath, stagingAlias);
	if (stagingSlot === rollback.slot) {
		throw new Error(
			'Refusing to promote: staging and production use the same slot'
		);
	}
	const buildId = await readCompleteBuildId(appPath, stagingSlot, 'staging');

	if (onRollbackCaptured) await onRollbackCaptured(rollback);
	const confirmedRollback = await captureProductionRollback(appPath);
	if (
		confirmedRollback.slot !== rollback.slot ||
		confirmedRollback.buildId !== rollback.buildId
	) {
		throw new Error(
			'Refusing to promote: production changed after rollback capture'
		);
	}
	await refuseAliasProcess(
		appPath,
		productionAlias,
		'promote staging',
		procDirectory
	);

	await aliasRepoint(appPath, productionAlias, stagingSlot);
	return { buildId, rollback, slot: stagingSlot };
}

export async function rollbackProduction({
	aliasRepoint = repointAlias,
	appDirectory = process.cwd(),
	buildId,
	procDirectory = '/proc',
	slot
} = {}) {
	const appPath = await realpath(appDirectory);
	await refuseAliasProcess(
		appPath,
		productionAlias,
		'roll back production',
		procDirectory
	);
	await resolveFixedSlot(appPath, productionAlias);
	await requireFixedSlotDirectory(appPath, slot);
	if (typeof buildId !== 'string' || buildId.length === 0) {
		throw new Error('Refusing to roll back: captured BUILD_ID is required');
	}

	const currentBuildId = await readCompleteBuildId(appPath, slot, 'rollback');
	if (currentBuildId !== buildId) {
		throw new Error(
			`Refusing to roll back ${slot}: captured BUILD_ID does not match current build`
		);
	}
	await refuseAliasProcess(
		appPath,
		productionAlias,
		'roll back production',
		procDirectory
	);
	await resolveFixedSlot(appPath, productionAlias);
	const confirmedBuildId = await readCompleteBuildId(appPath, slot, 'rollback');
	if (confirmedBuildId !== buildId) {
		throw new Error(
			`Refusing to roll back ${slot}: captured BUILD_ID does not match current build`
		);
	}

	await aliasRepoint(appPath, productionAlias, slot);
	return { buildId: confirmedBuildId, slot };
}

export function formatRollbackCommand({ buildId, slot }) {
	requireFixedSlotName(slot);
	if (typeof buildId !== 'string' || buildId.length === 0) {
		throw new Error('Captured BUILD_ID is required');
	}
	return (
		'pnpm --filter frontend-v4 run release:rollback-production -- ' +
		`${quoteShellArgument(slot)} ${quoteShellArgument(buildId)}`
	);
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
	await requireFixedSlotDirectory(appPath, slot);
	return slot;
}

async function captureProductionRollback(appPath) {
	const slot = await resolveFixedSlot(appPath, productionAlias);
	const buildId = await readCompleteBuildId(appPath, slot, 'production');
	return { buildId, command: formatRollbackCommand({ buildId, slot }), slot };
}

function requireFixedSlotName(slot) {
	if (!slots.includes(slot)) {
		throw new Error(`Rollback slot must be exactly ${slots.join(' or ')}`);
	}
}

async function requireFixedSlotDirectory(appPath, slot) {
	requireFixedSlotName(slot);
	const slotPath = path.join(appPath, slot);
	let resolved;
	try {
		resolved = await realpath(slotPath);
		if (resolved !== slotPath || !(await lstat(slotPath)).isDirectory())
			throw new Error();
	} catch {
		throw new Error(
			`${slot} must be a fixed directory within the frontend root`
		);
	}
}

async function readCompleteBuildId(appPath, slot, role) {
	await requireFixedSlotDirectory(appPath, slot);
	const buildIdPath = path.join(appPath, slot, 'BUILD_ID');
	let buildId;
	try {
		const buildIdStat = await lstat(buildIdPath);
		if (!buildIdStat.isFile() || buildIdStat.size > 2048) throw new Error();
		buildId = (await readFile(buildIdPath, 'utf8')).trim();
	} catch {
		throw new Error(`Refusing to use ${slot}: ${role} BUILD_ID is incomplete`);
	}
	if (!buildId || buildId.length > 1024 || /[\0\r\n]/u.test(buildId)) {
		throw new Error(`Refusing to use ${slot}: ${role} BUILD_ID is incomplete`);
	}
	return buildId;
}

function quoteShellArgument(value) {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
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
		const release = await promoteStaging({
			onRollbackCaptured(rollback) {
				process.stdout.write(
					`Captured rollback before promotion: ${rollback.command}\n`
				);
			}
		});
		process.stdout.write(
			`Promoted ${release.slot} (BUILD_ID ${release.buildId})\n`
		);
		return;
	}
	if (process.argv[2] === 'rollback-production') {
		const rawArgs = process.argv.slice(3);
		const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
		if (args.length !== 2) {
			throw new Error(
				'Expected rollback-production <slot> <captured BUILD_ID>'
			);
		}
		const release = await rollbackProduction({
			buildId: args[1],
			slot: args[0]
		});
		process.stdout.write(
			`Rolled production back to ${release.slot} (BUILD_ID ${release.buildId})\n`
		);
		return;
	}
	throw new Error(
		'Expected prepare-staging, promote-staging, or rollback-production'
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}
