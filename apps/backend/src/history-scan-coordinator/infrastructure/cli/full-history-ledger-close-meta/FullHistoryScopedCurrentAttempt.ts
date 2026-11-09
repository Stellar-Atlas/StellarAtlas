import { createHash } from 'node:crypto';
import fsModule, { constants as fsConstants, promises as fs, type BigIntStats } from 'node:fs';
import { posix as path } from 'node:path';

export interface ScopedCurrentAttemptPolicy {
	readonly permitId: string;
	readonly bulkDevice: bigint;
	readonly startLedger: number;
	readonly endLedger: number;
}

export type ScopedCurrentArm = () => Promise<() => void>;

const ARM_PATH = '/run/stellaratlas-history-admission/current-attempt.json';
const HOLD_PATH = '/run/stellaratlas-history-admission/hold';
const RUN_PATH = '/run';
const ADMISSION_DIR = '/run/stellaratlas-history-admission';
const TMPFS_MAGIC = 0x01021994n;
const MAX_CONTROL_BYTES = 4096;
const MAX_ENTRY_BYTES = 1024 * 1024;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL = /^[1-9][0-9]{0,19}$/;
const HASH = /^[0-9a-f]{64}$/;

type Arm = {
	version: 1; permitId: string; bootId: string; invocationId: string;
	bulkDevice: string; startLedger: number; endLedger: number; entryPath: string;
	entrySha256: string; expiresAt: string; holdDevice: string; holdInode: string; holdSha256: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseScopedCurrentAttemptPolicy(raw: string | undefined): ScopedCurrentAttemptPolicy | undefined {
	if (raw === undefined) return undefined;
	try {
		if (raw.length > MAX_CONTROL_BYTES) throw new Error();
		const value: unknown = JSON.parse(raw);
		if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'bulkDevice,endLedger,permitId,startLedger,version' ||
			value.version !== 1 || typeof value.permitId !== 'string' || !UUID.test(value.permitId) ||
			typeof value.bulkDevice !== 'string' || !DECIMAL.test(value.bulkDevice) ||
			!validRange(value.startLedger, value.endLedger)) throw new Error();
		return Object.freeze({ permitId: value.permitId, bulkDevice: BigInt(value.bulkDevice),
			startLedger: value.startLedger as number, endLedger: value.endLedger as number });
	} catch {
		throw new Error('Invalid scoped current-attempt policy');
	}
}

function validRange(start: unknown, end: unknown): boolean {
	if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) || start < 1 || end > 0xffff_ffff) return false;
	const count = end - start + 1;
	return count >= 64 && count <= 128;
}

function identity(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function fileVersion(a: BigIntStats, b: BigIntStats): boolean {
	return identity(a,b) && a.size === b.size && a.ctimeNs === b.ctimeNs && a.mtimeNs === b.mtimeNs;
}
function secureFile(stat: BigIntStats, maxBytes: number): boolean {
	return stat.uid === 0n && stat.isFile() && (stat.mode & 0o022n) === 0n &&
		stat.nlink === 1n && stat.size >= 0n && stat.size <= BigInt(maxBytes);
}

async function safeParents(): Promise<string | null> {
	try {
		const before: BigIntStats[] = [];
		for (const dir of [RUN_PATH, ADMISSION_DIR]) {
			const real = await fs.realpath(dir);
			if (real !== dir) return null;
			const stat = await fs.lstat(dir, { bigint: true });
			if (stat.uid !== 0n || !stat.isDirectory() || (stat.mode & 0o022n) !== 0n) return null;
			const fsInfo = await fs.statfs(dir, { bigint: true });
			if (fsInfo.type !== TMPFS_MAGIC) return null;
			before.push(stat);
		}
		for (let i = 0; i < before.length; i++) {
			const after = await fs.lstat([RUN_PATH, ADMISSION_DIR][i]!, { bigint: true });
			if (!identity(before[i]!, after) || after.uid !== 0n || !after.isDirectory() || (after.mode & 0o022n) !== 0n) return null;
		}
		return before.map(stat => `${stat.dev}:${stat.ino}`).join(':');
	} catch { return null; }
}
function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function canonicalIso(value: unknown, now: number): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
	const ms = Date.parse(value);
	return Number.isSafeInteger(now) && Number.isFinite(ms) && new Date(ms).toISOString() === value && ms > now && ms <= now + FIFTEEN_MINUTES;
}

async function readPinnedFile(filePath: string, maxBytes: number): Promise<{ bytes: Buffer; stat: BigIntStats } | null> {
	let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
	try {
		if (fsConstants.O_NOFOLLOW === undefined || fsConstants.O_NONBLOCK === undefined) return null;
		const before = await fs.lstat(filePath, { bigint: true });
		if (!secureFile(before, maxBytes)) return null;
		handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
		const opened = await handle.stat({ bigint: true });
		if (!secureFile(opened, maxBytes) || !fileVersion(before, opened)) return null;
		const bytes = Buffer.alloc(Number(opened.size));
		let total = 0;
		while (total < bytes.length) {
			const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
			if (!bytesRead) return null;
			total += bytesRead;
		}
		const afterFd = await handle.stat({ bigint: true });
		const afterPath = await fs.lstat(filePath, { bigint: true });
		if (!fileVersion(opened, afterFd) || !fileVersion(opened, afterPath) ||
			!secureFile(afterFd, maxBytes) || !secureFile(afterPath, maxBytes)) return null;
		return { bytes, stat: opened };
	} catch { return null; }
	finally { await handle?.close().catch(() => undefined); }
}

function parseArm(bytes: Buffer): Arm | null {
	try {
		const value: unknown = JSON.parse(bytes.toString('utf8'));
		const keys = 'version,permitId,bootId,invocationId,bulkDevice,startLedger,endLedger,entryPath,entrySha256,expiresAt,holdDevice,holdInode,holdSha256'.split(',').sort().join(',');
		if (!isRecord(value) || Object.keys(value).sort().join(',') !== keys) return null;
		if (value.version !== 1 || typeof value.permitId !== 'string' || !UUID.test(value.permitId) ||
			typeof value.bootId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.bootId) ||
			typeof value.invocationId !== 'string' || !/^[0-9a-f]{32}$/.test(value.invocationId) ||
			typeof value.bulkDevice !== 'string' || !DECIMAL.test(value.bulkDevice) ||
			!validRange(value.startLedger, value.endLedger) ||
			typeof value.entryPath !== 'string' || !path.isAbsolute(value.entryPath) || path.normalize(value.entryPath) !== value.entryPath ||
			typeof value.entrySha256 !== 'string' || !HASH.test(value.entrySha256) ||
			typeof value.holdDevice !== 'string' || !DECIMAL.test(value.holdDevice) ||
			typeof value.holdInode !== 'string' || !DECIMAL.test(value.holdInode) ||
			typeof value.holdSha256 !== 'string' || !HASH.test(value.holdSha256)) return null;
		return value as unknown as Arm;
	} catch { return null; }
}

async function currentBootId(): Promise<string | null> {
	try { return (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); } catch { return null; }
}

export async function readScopedCurrentArm(
	policy: ScopedCurrentAttemptPolicy, bootId: string, invocationId: string | undefined,
	entryPath: string | undefined, now: () => number,
): Promise<ScopedCurrentArm | null> {
	try {
		if (!invocationId || !entryPath || !/^[0-9a-f]{32}$/.test(invocationId)) return null;
		const parentsBefore = await safeParents();
		if (!parentsBefore) return null;
		const actualEntry = await fs.realpath(entryPath);
		if (actualEntry !== entryPath || !path.isAbsolute(actualEntry)) return null;
		const entry = await readPinnedFile(actualEntry, MAX_ENTRY_BYTES);
		if (!entry) return null;
		const armRead = await readPinnedFile(ARM_PATH, MAX_CONTROL_BYTES);
		const holdRead = await readPinnedFile(HOLD_PATH, MAX_CONTROL_BYTES);
		if (!armRead || !holdRead) return null;
		const arm = parseArm(armRead.bytes);
		if (!arm || !canonicalIso(arm.expiresAt, now()) || arm.permitId !== policy.permitId || arm.bootId !== bootId ||
			arm.invocationId !== invocationId || arm.bulkDevice !== policy.bulkDevice.toString() ||
			arm.startLedger !== policy.startLedger || arm.endLedger !== policy.endLedger || arm.entryPath !== actualEntry ||
			arm.entrySha256 !== sha256(entry.bytes) || arm.holdDevice !== String(holdRead.stat.dev) ||
			arm.holdInode !== String(holdRead.stat.ino) || arm.holdSha256 !== sha256(holdRead.bytes) ||
			(await currentBootId()) !== bootId || (await safeParents()) !== parentsBefore) return null;
		const armIdentity = armRead.stat;
		const holdIdentity = holdRead.stat;
		const holdContents = holdRead.bytes;
		const entryIdentity = entry.stat;
		return async () => {
			const [nextArm, nextHold, nextEntry, actualBoot] = await Promise.all([
				readPinnedFile(ARM_PATH, MAX_CONTROL_BYTES), readPinnedFile(HOLD_PATH, MAX_CONTROL_BYTES),
				readPinnedFile(actualEntry, MAX_ENTRY_BYTES), currentBootId(),
			]);
			if (!nextArm || !nextHold || !nextEntry || actualBoot !== bootId || (await safeParents()) !== parentsBefore ||
				(await fs.realpath(actualEntry)) !== actualEntry ||
				!fileVersion(armIdentity, nextArm.stat) || !fileVersion(holdIdentity, nextHold.stat) ||
				!fileVersion(entryIdentity, nextEntry.stat) || !nextArm.bytes.equals(armRead.bytes) ||
				!nextHold.bytes.equals(holdContents) || !nextEntry.bytes.equals(entry.bytes)) {
				throw new Error('Scoped current-attempt authorization is no longer valid');
			}
			// Use this after the last async lease check, immediately before linking or launching.
			return () => {
				for (const [name, expected, max] of [
					[ARM_PATH, armIdentity, MAX_CONTROL_BYTES], [HOLD_PATH, holdIdentity, MAX_CONTROL_BYTES],
					[actualEntry, entryIdentity, MAX_ENTRY_BYTES],
				] as const) {
					const named = fsModule.lstatSync(name, { bigint: true });
					if (!secureFile(named, max) || !fileVersion(expected, named))
						throw new Error('Scoped current-attempt authorization is no longer valid');
				}
				if (!canonicalIso(arm.expiresAt, now())) throw new Error('Scoped current-attempt authorization is no longer valid');
			};
		};
	} catch { return null; }
}
