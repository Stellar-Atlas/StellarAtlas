import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { normalizeIssuerDomain } from '../issuer-domains/IssuerDomainCache.js';
import type {
	FederationSchedule,
	FederationScheduleStore
} from './FederationProviderBudget.js';

const maxBytes = 96 * 1024;
const noFollow = constants.O_NOFOLLOW ?? 0;
const nonBlocking = constants.O_NONBLOCK ?? 0;
type SyncDirectory = (path: string) => Promise<void>;

/** All cohosted processes must use the same operator-owned private local directory. */
export class SharedFederationScheduleStore implements FederationScheduleStore {
	private completions: Promise<unknown> = Promise.resolve();
	private needsRecovery = false;

	constructor(
		private readonly directory: string,
		private readonly syncDirectory: SyncDirectory = syncFederationDirectory
	) {
		if (!isAbsolute(directory))
			throw new Error('Federation schedule directory must be absolute');
	}

	update<T>(
		work: (schedules: Map<string, FederationSchedule>) => T,
		mode?: 'completion'
	): Promise<T> {
		if (mode !== 'completion') return this.withLock(work, false);
		const completion = this.completions.then(() => this.withLock(work, true));
		this.completions = completion.catch(() => {
			this.needsRecovery = true;
		});
		return completion;
	}

	async drain(): Promise<void> {
		await this.completions;
		if (this.needsRecovery)
			throw new Error('Federation schedule requires recovery');
	}

	private async withLock<T>(
		work: (schedules: Map<string, FederationSchedule>) => T,
		completion: boolean
	): Promise<T> {
		const directory = await requireFederationScheduleDirectory(this.directory);
		const lockPath = join(directory, 'federation-schedule.lock');
		const lock = await acquire(lockPath, completion);
		let writeUncertain = false;
		try {
			const statePath = join(directory, 'federation-schedule.json');
			const schedules = await read(statePath);
			const next = join(directory, 'federation-schedule.next');
			writeUncertain = true;
			if (await inspectLeaf(next))
				throw new Error('Uncertain federation schedule write needs manual recovery');
			writeUncertain = false;
			const result = work(schedules);
			const bytes = serialize(schedules);
			writeUncertain = true;
			await writeSyncedFile(next, bytes);
			await rename(next, statePath);
			await this.syncDirectory(directory);
			writeUncertain = false;
			return result;
		} finally {
			if (writeUncertain) this.needsRecovery = true;
			try {
				// Preserve the lock if a write or barrier fails.
				try {
					if (!writeUncertain) {
						const entry = await inspectLeaf(lockPath);
						if (!entry || !sameFile(entry, await lock.stat()))
							throw new Error('Federation schedule lock changed');
					}
				} finally {
					await lock.close();
				}
				if (!writeUncertain) await unlink(lockPath);
			} catch (error) {
				this.needsRecovery = true;
				throw error;
			}
		}
	}
}

export async function requireFederationScheduleDirectory(
	path: string
): Promise<string> {
	if (!isAbsolute(path))
		throw new Error('Federation schedule directory must be absolute');
	if (resolve(path) !== path)
		throw new Error('Federation schedule directory must be canonical');
	const uid = process.getuid?.();
	await requireTrustedParents(dirname(path), uid);
	const directory = await lstat(path);
	if (!directory.isDirectory() || !isPrivate(directory, uid) ||
		(process.platform === 'win32' && (await realpath(path)) !== path))
		throw new Error(
			'Federation schedule requires a private canonical directory owned by the API user'
		);
	return path;
}

async function requireTrustedParents(path: string, uid: number | undefined): Promise<void> {
	const parent = dirname(path);
	if (parent !== path) await requireTrustedParents(parent, uid);
	const entry = await lstat(path);
	// A trusted sticky directory such as /tmp protects API-owned children.
	if (!entry.isDirectory() ||
		(uid !== undefined &&
			((entry.uid !== uid && entry.uid !== 0) ||
				((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0))))
		throw new Error('Federation schedule requires trusted canonical parents');
}

function isPrivate(entry: Stats, uid = process.getuid?.()): boolean {
	return uid === undefined || (entry.uid === uid && (entry.mode & 0o077) === 0);
}

function sameFile(first: Stats, second: Stats): boolean {
	return first.dev === second.dev && first.ino === second.ino;
}

async function inspectLeaf(path: string): Promise<Stats | null> {
	const entry = await lstat(path).catch((error: unknown) => {
		if (hasCode(error, 'ENOENT')) return null;
		throw error;
	});
	if (entry && (!entry.isFile() || entry.nlink !== 1 || !isPrivate(entry)))
		throw new Error('Federation schedule requires private ordinary files');
	return entry;
}

/** Offline recovery. Quiesce every old owner before preparing or using the replacement. */
export async function recoverFederationSchedule(
	oldPath: string,
	replacementPath: string,
	allOwnersStopped: true,
	syncDirectory: SyncDirectory = syncFederationDirectory
): Promise<void> {
	if (allOwnersStopped !== true)
		throw new Error('All federation owners must be stopped');
	const oldDirectory = await requireFederationScheduleDirectory(oldPath);
	if (
		!isAbsolute(replacementPath) ||
		resolve(replacementPath) !== replacementPath ||
		dirname(replacementPath) !== dirname(oldDirectory)
	)
		throw new Error('Federation recovery requires a new sibling directory');
	if (!(await inspectLeaf(join(oldDirectory, 'federation-schedule.lock'))))
		throw new Error('Federation recovery requires an abandoned lock file');
	const stage = await lstat(
		join(oldDirectory, 'federation-schedule.next')
	).catch((error: unknown) => {
		if (hasCode(error, 'ENOENT')) return null;
		throw error;
	});
	if (stage)
		throw new Error(
			'Uncertain federation schedule write needs manual recovery'
		);
	const statePath = join(oldDirectory, 'federation-schedule.json');
	const schedules = await read(statePath, true);
	for (const schedule of schedules.values()) schedule.active = 0;
	await mkdir(replacementPath, { mode: 0o700 });
	const replacement = await requireFederationScheduleDirectory(replacementPath);
	// Leave an incomplete replacement visibly fenced if a write or sync fails.
	const recoveryLockPath = join(replacement, 'federation-schedule.lock');
	await writeSyncedFile(recoveryLockPath, '');
	await writeSyncedFile(
		join(replacement, 'federation-schedule.json'),
		serialize(schedules)
	);
	await syncDirectory(replacement);
	await syncDirectory(dirname(replacement));
	await unlink(recoveryLockPath);
}

export async function syncFederationDirectory(path: string): Promise<void> {
	const directory = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollow);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

async function writeSyncedFile(path: string, bytes: string): Promise<void> {
	const file = await createPrivateFile(path);
	try {
		await file.writeFile(bytes, 'utf8');
		await file.sync();
	} finally {
		await file.close();
	}
}

function createPrivateFile(path: string) {
	return open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
}

function serialize(schedules: Map<string, FederationSchedule>): string {
	const bytes = JSON.stringify(
		[...schedules].map(([host, value]) => [
			host,
			value.windowUntil,
			value.requests,
			value.active,
			value.failures,
			value.retryAt
		])
	);
	if (Buffer.byteLength(bytes) > maxBytes)
		throw new Error('Federation schedule exceeds its byte budget');
	return bytes;
}

async function acquire(path: string, completion: boolean) {
	const delays = [0, 10, 20, 40, 80, 100];
	for (let attempt = 0; ; attempt++) {
		const delay = delays[attempt] ?? 250;
		// An admitted slot still needs completion when the worker becomes idle.
		if (delay) await setTimeout(delay);
		try {
			return await createPrivateFile(path);
		} catch (error) {
			if (!hasCode(error, 'EEXIST')) throw error;
			await inspectLeaf(path);
		}
		if (!completion && attempt === delays.length - 1)
			throw new Error('Federation schedule is busy or needs recovery');
		// Only lock acquisition retries. The owner alone may remove its lock.
	}
}

async function read(path: string, required = false): Promise<Map<string, FederationSchedule>> {
	const entry = await inspectLeaf(path);
	if (!entry) {
		if (required) throw new Error('Committed federation schedule unavailable');
		return new Map();
	}
	const file = await open(path, constants.O_RDONLY | noFollow | nonBlocking);
	try {
		const opened = await file.stat();
		if (!sameFile(entry, opened) || !opened.isFile() || opened.nlink !== 1 || !isPrivate(opened))
			throw new Error('Federation schedule changed during open');
		const { size } = opened;
		if (size < 1 || size > maxBytes)
			throw new Error('Federation schedule has invalid size');
		const bytes = Buffer.alloc(size);
		const { bytesRead } = await file.read(bytes, 0, size, 0);
		if (bytesRead !== size)
			throw new Error('Federation schedule changed during read');
		const rows: unknown = JSON.parse(bytes.toString('utf8'));
		if (!Array.isArray(rows) || rows.length > 256)
			throw new Error('Invalid federation schedule');
		const schedules = new Map<string, FederationSchedule>();
		for (const row of rows as unknown[]) {
			if (!Array.isArray(row) || row.length !== 6)
				throw new Error('Invalid federation schedule row');
			const [host, windowUntil, requests, active, failures, retryAt] =
				row as unknown[];
			if (
				typeof host !== 'string' ||
				host.length > 253 ||
				normalizeIssuerDomain(host) !== host ||
				schedules.has(host) ||
				!integer(windowUntil, Number.MAX_SAFE_INTEGER) ||
				!integer(requests, 8) ||
				!integer(active, 2) ||
				!integer(failures, 7) ||
				!integer(retryAt, Number.MAX_SAFE_INTEGER)
			)
				throw new Error('Invalid federation schedule row');
			schedules.set(host, { windowUntil, requests, active, failures, retryAt });
		}
		return schedules;
	} finally {
		await file.close();
	}
}

function integer(value: unknown, max: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= max
	);
}

function hasCode(value: unknown, code: string): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		'code' in value &&
		value.code === code
	);
}
