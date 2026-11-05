import {
	lstat,
	mkdir,
	open,
	realpath,
	rename,
	unlink,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { normalizeIssuerDomain } from '../issuer-domains/IssuerDomainCache.js';
import type {
	FederationSchedule,
	FederationScheduleStore
} from './FederationProviderBudget.js';

const maxBytes = 96 * 1024;

/** All cohosted processes must use the same operator-owned private local directory. */
export class SharedFederationScheduleStore implements FederationScheduleStore {
	private completions: Promise<unknown> = Promise.resolve();
	private completionFailed = false;

	constructor(private readonly directory: string) {
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
			this.completionFailed = true;
		});
		return completion;
	}

	async drain(): Promise<void> {
		await this.completions;
		if (this.completionFailed)
			throw new Error('Federation completion requires recovery');
	}

	private async withLock<T>(
		work: (schedules: Map<string, FederationSchedule>) => T,
		completion: boolean
	): Promise<T> {
		const lockPath = join(this.directory, 'federation-schedule.lock');
		const lock = await acquire(lockPath, completion);
		try {
			const statePath = join(this.directory, 'federation-schedule.json');
			const schedules = await read(statePath);
			const result = work(schedules);
			const next = join(this.directory, 'federation-schedule.next');
			await writeFile(next, serialize(schedules), { flag: 'wx', mode: 0o600 });
			try {
				await rename(next, statePath);
			} catch (error) {
				await unlink(next);
				throw error;
			}
			return result;
		} finally {
			await lock.close();
			await unlink(lockPath);
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
	allOwnersStopped: true
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
	await writeFile(
		join(replacementPath, 'federation-schedule.json'),
		serialize(schedules),
		{
			flag: 'wx',
			mode: 0o600
		}
	);
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
