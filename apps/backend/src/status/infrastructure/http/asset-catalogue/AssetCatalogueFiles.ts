import { randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
	lstat,
	mkdir,
	open,
	realpath,
	rename,
	unlink,
	type FileHandle
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const snapshotName = 'catalogue.json';
const lockName = 'catalogue.lock';
const staleLockMs = 900_000;
const uid = process.getuid?.();
const noFollow = constants.O_NOFOLLOW ?? 0;
const nonBlock = constants.O_NONBLOCK ?? 0;

function hasCode(error: unknown, code: string): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === code
	);
}

async function fileInfo(path: string): Promise<Stats | undefined> {
	return await lstat(path).catch((error: unknown) => {
		if (hasCode(error, 'ENOENT')) return undefined;
		throw error;
	});
}

function ordinaryFile(info: Stats): void {
	if (
		!info.isFile() ||
		info.nlink !== 1 ||
		(uid !== undefined && (info.uid !== uid || (info.mode & 0o022) !== 0))
	)
		throw new Error('Unsafe asset catalogue file');
}

function sameFile(a: Stats, b: Stats): boolean {
	return a.dev === b.dev && a.ino === b.ino;
}

async function trustedAncestors(path: string): Promise<void> {
	for (let current = path; ; current = dirname(current)) {
		const info = await lstat(current);
		// A root-owned sticky temporary directory may host a private, owned child.
		const stickyRootDirectory = info.uid === 0 && (info.mode & 0o1000) !== 0;
		if (
			!info.isDirectory() ||
			(uid !== undefined &&
				((info.uid !== 0 && info.uid !== uid) ||
					((info.mode & 0o022) !== 0 && !stickyRootDirectory)))
		)
			throw new Error('Unsafe asset catalogue ancestor');
		if (dirname(current) === current) return;
	}
}

/** Fixed cache children in a canonical directory that untrusted users cannot replace. */
export class AssetCatalogueFiles {
	private constructor(private readonly directory: string) {}

	static async open(
		directory: string,
		create: boolean
	): Promise<AssetCatalogueFiles | undefined> {
		if (
			!isAbsolute(directory) ||
			resolve(directory) !== directory ||
			dirname(directory) === directory ||
			(process.platform === 'win32' && !/^[A-Za-z]:\\/.test(directory))
		)
			throw new Error(
				'Asset catalogue directory must be canonical and absolute'
			);
		const parent = dirname(directory);
		await trustedAncestors(parent);
		if (create) {
			await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
				if (!hasCode(error, 'EEXIST')) throw error;
			});
		}
		const info = await fileInfo(directory);
		if (!info) return undefined;
		if (
			!info.isDirectory() ||
			(uid !== undefined && (info.uid !== uid || (info.mode & 0o022) !== 0)) ||
			(await realpath(directory)) !== directory
		)
			throw new Error('Unsafe asset catalogue directory');
		return new AssetCatalogueFiles(directory);
	}

	private child(
		name: typeof snapshotName | typeof lockName | `catalogue.${string}.tmp`
	): string {
		const path = join(this.directory, name);
		if (
			!path.startsWith(this.directory + sep) ||
			dirname(path) !== this.directory
		)
			throw new Error('Asset catalogue file escaped its directory');
		return path;
	}

	async readSnapshot(
		knownMtime?: number
	): Promise<{ mtime: number; json?: string } | undefined> {
		const path = this.child(snapshotName);
		const expected = await fileInfo(path);
		if (!expected) return undefined;
		ordinaryFile(expected);
		const file = await open(path, constants.O_RDONLY | noFollow | nonBlock);
		try {
			const info = await file.stat();
			ordinaryFile(info);
			if (!sameFile(expected, info))
				throw new Error('Asset catalogue snapshot changed during open');
			return info.mtimeMs === knownMtime
				? { mtime: info.mtimeMs }
				: { mtime: info.mtimeMs, json: await file.readFile('utf8') };
		} finally {
			await file.close();
		}
	}

	async lock(): Promise<(() => Promise<void>) | undefined> {
		const snapshot = await fileInfo(this.child(snapshotName));
		if (snapshot) ordinaryFile(snapshot);
		const path = this.child(lockName);
		const previous = await fileInfo(path);
		if (previous) {
			ordinaryFile(previous);
			if (Date.now() - previous.mtimeMs <= staleLockMs) return undefined;
			await this.unlinkMatching(path, previous);
		}
		const file = await open(path, 'wx', 0o600).catch((error: unknown) => {
			if (hasCode(error, 'EEXIST')) return undefined;
			throw error;
		});
		if (!file) return undefined;
		const owned = await this.openedInfo(file);
		return async () => {
			await file.close();
			await this.unlinkMatching(path, owned);
		};
	}

	async replaceSnapshot(json: string): Promise<void> {
		const target = this.child(snapshotName);
		const temporary = this.child(
			`catalogue.${randomBytes(12).toString('hex')}.tmp`
		);
		const file = await open(temporary, 'wx', 0o600);
		const owned = await this.openedInfo(file);
		try {
			try {
				await file.writeFile(json, 'utf8');
			} finally {
				await file.close();
			}
			const previous = await fileInfo(target);
			if (previous) ordinaryFile(previous);
			const current = await fileInfo(temporary);
			if (!current || !sameFile(current, owned))
				throw new Error(
					'Asset catalogue temporary file changed before promotion'
				);
			ordinaryFile(current);
			await rename(temporary, target);
		} finally {
			await this.unlinkMatching(temporary, owned);
		}
	}

	private async openedInfo(file: FileHandle): Promise<Stats> {
		try {
			const info = await file.stat();
			ordinaryFile(info);
			return info;
		} catch (error) {
			await file.close();
			throw error;
		}
	}

	private async unlinkMatching(path: string, expected: Stats): Promise<void> {
		const current = await fileInfo(path);
		if (!current || !sameFile(current, expected)) return;
		ordinaryFile(current);
		await unlink(path).catch((error: unknown) => {
			if (!hasCode(error, 'ENOENT')) throw error;
		});
	}
}
