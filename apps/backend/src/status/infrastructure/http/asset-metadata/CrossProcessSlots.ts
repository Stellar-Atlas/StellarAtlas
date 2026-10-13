import { mkdir, open, rm, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

const staleAfterMs = 90_000;
const retryMs = 100;
const maxWaitMs = 60_000;

export class CrossProcessSlots {
	public constructor(
		private readonly root: string,
		private readonly count = 2,
		private readonly now: () => number = Date.now
	) {}

	public async acquire(): Promise<() => Promise<void>> {
		const directory = join(this.root, 'network-slots');
		await mkdir(directory, { recursive: true });
		const started = this.now();
		while (this.now() - started < maxWaitMs) {
			for (let index = 0; index < this.count; index++) {
				const path = join(directory, `slot-${index}.lock`);
				const handle = await tryOpen(path);
				if (handle) return this.release(path, handle);
				await reapStale(path, this.now());
			}
			await delay(retryMs);
		}
		throw new Error('Asset metadata refresh queue is full');
	}

	private release(path: string, handle: FileHandle): () => Promise<void> {
		const heartbeat = setInterval(() => {
			const now = new Date();
			void handle.utimes(now, now).catch(() => undefined);
		}, 20_000);
		heartbeat.unref();
		return async () => {
			clearInterval(heartbeat);
			try {
				const [own, current] = await Promise.all([handle.stat(), stat(path)]);
				if (own.ino === current.ino && own.dev === current.dev)
					await rm(path, { force: true });
			} catch (error) {
				if (!isRecord(error) || error.code !== 'ENOENT') throw error;
			} finally {
				await handle.close();
			}
		};
	}
}

async function tryOpen(path: string): Promise<FileHandle | null> {
	try {
		return await open(path, 'wx', 0o600);
	} catch (error) {
		if (isRecord(error) && error.code === 'EEXIST') return null;
		throw error;
	}
}

async function reapStale(path: string, now: number): Promise<void> {
	try {
		const info = await stat(path);
		if (now - info.mtimeMs > staleAfterMs) await rm(path, { force: true });
	} catch {
		// A competing worker may have released the slot while it was checked.
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
