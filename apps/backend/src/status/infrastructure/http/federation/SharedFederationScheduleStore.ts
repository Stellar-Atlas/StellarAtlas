import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { normalizeIssuerDomain } from '../issuer-domains/IssuerDomainCache.js';
import type {
	FederationSchedule,
	FederationScheduleStore
} from './FederationProviderBudget.js';

const maxBytes = 96 * 1024;
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
		const lockPath = join(this.directory, 'federation-schedule.lock');
		const lock = await acquire(lockPath, completion);
		let writeUncertain = false;
		try {
			const statePath = join(this.directory, 'federation-schedule.json');
			const schedules = await read(statePath);
			const result = work(schedules);
			const bytes = serialize(schedules);
			const next = join(this.directory, 'federation-schedule.next');
			writeUncertain = true;
			await writeSyncedFile(next, bytes);
			await rename(next, statePath);
			await this.syncDirectory(this.directory);
			writeUncertain = false;
			return result;
		} finally {
			if (writeUncertain) this.needsRecovery = true;
			try {
				await lock.close();
				// Preserve the lock if a write or barrier fails.
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
	const canonical = await realpath(path);
	const directory = await lstat(path);
	const uid = process.getuid?.();
	if (
		resolve(path) !== canonical ||
		!directory.isDirectory() ||
		(uid !== undefined &&
			(directory.uid !== uid || (directory.mode & 0o077) !== 0))
	)
		throw new Error(
			'Federation schedule requires a private canonical directory owned by the API user'
		);
	return canonical;
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
	if (!(await lstat(join(oldDirectory, 'federation-schedule.lock'))).isFile())
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
	if (!(await lstat(statePath)).isFile())
		throw new Error('Committed federation schedule unavailable');
	const schedules = await read(statePath);
	for (const schedule of schedules.values()) schedule.active = 0;
	await mkdir(replacementPath, { mode: 0o700 });
	// Leave an incomplete replacement visibly fenced if a write or sync fails.
	const recoveryLockPath = join(replacementPath, 'federation-schedule.lock');
	await writeSyncedFile(recoveryLockPath, '');
	await writeSyncedFile(
		join(replacementPath, 'federation-schedule.json'),
		serialize(schedules)
	);
	await syncDirectory(replacementPath);
	await syncDirectory(dirname(replacementPath));
	await unlink(recoveryLockPath);
}

export async function syncFederationDirectory(path: string): Promise<void> {
	const directory = await open(path, 'r');
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

async function writeSyncedFile(path: string, bytes: string): Promise<void> {
	const file = await open(path, 'wx', 0o600);
	try {
		await file.writeFile(bytes, 'utf8');
		await file.sync();
	} finally {
		await file.close();
	}
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
			return await open(path, 'wx', 0o600);
		} catch (error) {
			if (!hasCode(error, 'EEXIST')) throw error;
		}
		if (!completion && attempt === delays.length - 1)
			throw new Error('Federation schedule is busy or needs recovery');
		// Only lock acquisition retries. The owner alone may remove its lock.
	}
}

async function read(path: string): Promise<Map<string, FederationSchedule>> {
	const file = await open(path, 'r').catch((error: unknown) => {
		if (hasCode(error, 'ENOENT')) return null;
		throw error;
	});
	if (!file) return new Map();
	try {
		const { size } = await file.stat();
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
