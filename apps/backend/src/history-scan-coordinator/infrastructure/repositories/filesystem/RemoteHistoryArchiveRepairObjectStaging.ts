import {
	mkdir,
	lstat,
	readdir,
	realpath,
	rm,
	rmdir,
	stat,
	unlink
} from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const staleStageAgeMs = 60 * 60_000;
const maximumStageDirectories = 8;

export interface StagedRepairObject {
	readonly directory: string;
	readonly filePath: string;
}

export class StagingCapacityError extends Error {}

export async function cleanupRepairStage(
	stage: StagedRepairObject
): Promise<void> {
	await unlink(stage.filePath).catch(() => undefined);
	await rmdir(stage.directory).catch(() => undefined);
}

export async function prepareRepairStagingDirectory(
	directory: string
): Promise<void> {
	const before = await lstat(directory).catch((error: unknown) => {
		if (isErrorCode(error, 'ENOENT')) return null;
		throw error;
	});
	if (before === null) {
		await mkdir(directory, { mode: 0o700, recursive: true });
	} else if (before.isSymbolicLink() || !before.isDirectory()) {
		throw new StagingCapacityError();
	}
	const metadata = await lstat(directory);
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		throw new StagingCapacityError();
	}
	if (
		process.platform !== 'win32' &&
		((metadata.mode & 0o077) !== 0 ||
			(typeof process.getuid === 'function' &&
				metadata.uid !== process.getuid()))
	) {
		throw new StagingCapacityError();
	}
	const actual = await realpath(directory);
	if (normalizePath(actual) !== normalizePath(directory)) {
		throw new StagingCapacityError();
	}
	await removeStaleRepairStages(directory);
}

export async function createRepairStageDirectory(
	directory: string
): Promise<string> {
	for (let slot = 0; slot < maximumStageDirectories; slot++) {
		const candidate = join(directory, `object-slot-${slot}`);
		try {
			await mkdir(candidate, { mode: 0o700 });
			return candidate;
		} catch (error) {
			if (isErrorCode(error, 'EEXIST')) continue;
			throw error;
		}
	}
	throw new StagingCapacityError();
}

async function removeStaleRepairStages(directory: string): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	const cutoff = Date.now() - staleStageAgeMs;
	const stages = await Promise.all(
		entries
			.filter(
				(candidate) =>
					candidate.isDirectory() && /^object-[\w-]+$/.test(candidate.name)
			)
			.map(async (entry) => ({
				entry,
				metadata: await stat(resolve(directory, entry.name)).catch(() => null)
			}))
	);
	stages.sort(
		(left, right) =>
			(left.metadata?.mtimeMs ?? 0) - (right.metadata?.mtimeMs ?? 0) ||
			left.entry.name.localeCompare(right.entry.name)
	);
	for (const { entry, metadata } of stages) {
		const candidate = resolve(directory, entry.name);
		if (!candidate.startsWith(`${resolve(directory)}${sep}`)) continue;
		if (metadata === null || metadata.mtimeMs >= cutoff) continue;
		await rm(candidate, { force: true, recursive: true }).catch(
			() => undefined
		);
	}
}

function normalizePath(value: string): string {
	const normalized = resolve(value);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === code
	);
}
