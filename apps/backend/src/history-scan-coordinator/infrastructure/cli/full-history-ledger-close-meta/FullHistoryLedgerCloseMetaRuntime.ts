import { constants } from 'node:fs';
import {
	access,
	lstat,
	mkdir,
	readdir,
	realpath,
	rm,
	statfs
} from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { FullHistoryLedgerCloseMetaServiceConfig } from './FullHistoryLedgerCloseMetaServiceConfig.js';

const sharedMemoryRoot = '/dev/shm';
const tmpfsMagic = 0x0102_1994n;
const transientDirectoryPattern = /^ledger-close-meta-[A-Za-z0-9]+$/;
const networkDirectoryPattern = /^[a-f0-9]{64}$/;
const stagingDirectoryPattern = /^\.[1-9][0-9]*-[1-9][0-9]*\.tmp-[A-Za-z0-9]+$/;
export const FULL_HISTORY_LEDGER_CLOSE_META_CLEANUP_INTERVAL_MILLISECONDS = 60_000;

export async function ensureFullHistoryLedgerCloseMetaRuntime(
	config: FullHistoryLedgerCloseMetaServiceConfig
): Promise<void> {
	await access(config.executablePath, constants.X_OK);
	await mkdir(config.temporaryInputRoot, { mode: 0o700, recursive: true });
	await mkdir(config.typedOutputRoot, { mode: 0o750, recursive: true });
	const [sharedMemoryPath, transientPath, transientInfo, fileSystem] =
		await Promise.all([
			realpath(sharedMemoryRoot),
			realpath(config.temporaryInputRoot),
			lstat(config.temporaryInputRoot),
			statfs(config.temporaryInputRoot, { bigint: true })
		]);
	if (
		!transientInfo.isDirectory() ||
		transientInfo.isSymbolicLink() ||
		(transientInfo.mode & 0o077) !== 0 ||
		!isStrictChild(sharedMemoryPath, transientPath) ||
		fileSystem.type !== tmpfsMagic
	) {
		throw new Error(
			'LedgerCloseMeta transient input root must be a private tmpfs directory under /dev/shm'
		);
	}
}

export async function removeStaleFullHistoryLedgerCloseMetaArtifacts(
	config: FullHistoryLedgerCloseMetaServiceConfig,
	nowMilliseconds: number
): Promise<void> {
	if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0) {
		throw new RangeError('Runtime cleanup clock is invalid');
	}
	const staleBefore =
		nowMilliseconds -
		config.processTimeoutMilliseconds -
		FULL_HISTORY_LEDGER_CLOSE_META_CLEANUP_INTERVAL_MILLISECONDS;
	await removeOwnedDirectories(
		config,
		(_path, info) => info.mtimeMs <= staleBefore
	);
}

export async function resetOwnedFullHistoryLedgerCloseMetaArtifacts(
	config: FullHistoryLedgerCloseMetaServiceConfig
): Promise<void> {
	await removeOwnedDirectories(config, () => true);
}

async function removeOwnedDirectories(
	config: FullHistoryLedgerCloseMetaServiceConfig,
	shouldRemove: (path: string, info: Awaited<ReturnType<typeof lstat>>) => boolean
): Promise<void> {
	await removeMatchingDirectories(
		config.temporaryInputRoot,
		transientDirectoryPattern,
		shouldRemove
	);
	for (const network of await safeDirectories(config.typedOutputRoot)) {
		if (!networkDirectoryPattern.test(network.name)) continue;
		const publicationRoot = join(
			config.typedOutputRoot,
			network.name,
			'ledger-close-meta'
		);
		await removeMatchingDirectories(
			publicationRoot,
			stagingDirectoryPattern,
			shouldRemove
		);
	}
}

async function removeMatchingDirectories(
	root: string,
	pattern: RegExp,
	shouldRemove: (path: string, info: Awaited<ReturnType<typeof lstat>>) => boolean
): Promise<void> {
	for (const entry of await safeDirectories(root)) {
		if (!pattern.test(entry.name)) continue;
		const path = join(root, entry.name);
		const info = await lstat(path);
		if (
			info.isDirectory() &&
			!info.isSymbolicLink() &&
			shouldRemove(path, info)
		) {
			await rm(path, { force: true, recursive: true });
		}
	}
}

async function safeDirectories(root: string) {
	try {
		return (await readdir(root, { withFileTypes: true })).filter(
			(entry) => entry.isDirectory() && !entry.isSymbolicLink()
		);
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
}

function isStrictChild(parent: string, candidate: string): boolean {
	const child = relative(parent, candidate);
	return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`);
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ENOENT'
	);
}
