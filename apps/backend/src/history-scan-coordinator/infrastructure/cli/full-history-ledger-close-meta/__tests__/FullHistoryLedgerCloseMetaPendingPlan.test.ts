import { jest } from '@jest/globals';
import type { PendingPlan } from '../FullHistoryLedgerCloseMetaPendingPlan.js';

const flags = { O_RDONLY: 0, O_NOFOLLOW: 0x20000, O_NONBLOCK: 0x800 };
const file = '/mock/pending-plan.json';
const maximumBytes = 131_072;
const plan: PendingPlan = {
	version: 1, kind: 'historical', networkPassphraseHash: '22'.repeat(32),
	sourceId: 'source', configDigest: '11'.repeat(32),
	partitionVersion: 'source-aligned-remainder-v1', sourceBatchLedgerCount: 1,
	typedShardLedgerCount: 64, startLedger: 3, endLedger: 66,
	shards: [{ startLedger: 3, endLedger: 66 }]
};
const payload = Buffer.from(JSON.stringify(plan));
let cursor = 0;
const close = jest.fn(async () => {});
const fileVersion = { isFile: () => true, size: BigInt(payload.byteLength),
	dev: 4n, ino: 7n, mtimeNs: 10n, ctimeNs: 11n };
const stat = jest.fn(async () => fileVersion);
const linkSync = jest.fn();
const lstatSync = jest.fn(() => fileVersion);
const unlinkSync = jest.fn();
const unlink = jest.fn(async (_path: string) => {});
const rename = jest.fn();
const writeFile = jest.fn(async (_contents: string, _encoding: string) => {});
const sync = jest.fn(async () => {});
const read = jest.fn(async (
	buffer: Buffer, offset = 0, length = buffer.byteLength - offset, position: number | null = null
) => {
	const start = position ?? cursor;
	const bytesRead = payload.copy(buffer, offset, start, start + length);
	if (position === null) cursor += bytesRead;
	return { bytesRead, buffer };
});
const handle = { stat, read, close, writeFile, sync };
const open = jest.fn(async (_file: string, _flags: number | string, _mode?: number) => handle);

jest.unstable_mockModule('node:fs', () => ({ constants: flags, linkSync, lstatSync, unlinkSync }));
jest.unstable_mockModule('node:fs/promises', () => ({ open, rename, unlink }));

const { FileFullHistoryLedgerCloseMetaPendingPlan: Store } =
	await import('../FullHistoryLedgerCloseMetaPendingPlan.js');

describe('FileFullHistoryLedgerCloseMetaPendingPlan descriptor-safe reads', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		cursor = 0;
		open.mockImplementation(async () => handle);
		stat.mockImplementation(async () => fileVersion);
		lstatSync.mockImplementation(() => fileVersion);
	});

	it('returns null when opening a missing plan', async () => {
		open.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
		await expect(new Store(file).read()).resolves.toBeNull();
		expect(stat).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('opens no-follow and nonblocking, then reads a valid plan through a bounded buffer', async () => {
		await expect(new Store(file).read()).resolves.toEqual(plan);
		expect(open).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledWith(file, flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
		expect(stat).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalled();
		for (const [buffer, offset, length] of read.mock.calls) {
			expect(Buffer.isBuffer(buffer)).toBe(true);
			expect(buffer.byteLength).toBeLessThanOrEqual(maximumBytes + 1);
			expect((offset ?? 0) + (length ?? buffer.byteLength)).toBeLessThanOrEqual(maximumBytes + 1);
		}
		expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ label: 'nonregular', regular: false, size: payload.byteLength },
		{ label: 'oversize', regular: true, size: maximumBytes + 1 }
	])('rejects an opened $label descriptor and closes it', async ({ regular, size }) => {
		stat.mockResolvedValueOnce({ ...fileVersion, isFile: () => regular, size: BigInt(size) });
		await expect(new Store(file).read()).rejects.toThrow(/bounded regular file|bounded size limit/);
		expect(read).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('rejects ELOOP as a non-symlink policy failure', async () => {
		open.mockRejectedValueOnce(Object.assign(new Error('symlink'), { code: 'ELOOP' }));
		await expect(new Store(file).read()).rejects.toThrow(/regular non-symlink file/);
		expect(stat).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('does not unlink a verified plan if leadership is lost after the last descriptor read', async () => {
		const store = new Store(file);
		const expected = await store.read();
		if (expected === null) throw new Error('fixture must have a plan');
		await expect(store.clearVerified(expected, async () => {
			expect(open).toHaveBeenCalledTimes(2);
			throw new Error('leadership lost');
		})).rejects.toThrow(/leadership lost/);
		expect(lstatSync).not.toHaveBeenCalled();
		expect(unlinkSync).not.toHaveBeenCalled();
	});

	it('does not unlink a same-content replacement that arrives during the final lease check', async () => {
		const store = new Store(file);
		const expected = await store.read();
		if (expected === null) throw new Error('fixture must have a plan');
		await expect(store.clearVerified(expected, async () => {
			lstatSync.mockReturnValueOnce({ ...fileVersion, ino: 8n });
		})).rejects.toThrow(/refusing to clear/);
		expect(unlinkSync).not.toHaveBeenCalled();
	});

	it('does not install the staged plan if the same session no longer holds leadership', async () => {
		await expect(new Store(file).installVerified(plan, async () => {
			expect(sync).toHaveBeenCalledTimes(1);
			expect(close).toHaveBeenCalledTimes(1);
			throw new Error('leadership lost');
		})).rejects.toThrow('leadership lost');
		expect(linkSync).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(unlink).toHaveBeenCalledWith(open.mock.calls[0]?.[0]);
	});

	it('leaves a competing destination intact and fails closed on atomic installation', async () => {
		await expect(new Store(file).installVerified(plan, async () => {
			linkSync.mockImplementationOnce(() => {
				throw Object.assign(new Error('competing plan'), { code: 'EEXIST' });
			});
		})).rejects.toThrow(/refusing to replace/);
		const temporary = open.mock.calls[0]?.[0];
		expect(linkSync).toHaveBeenCalledWith(temporary, file);
		expect(rename).not.toHaveBeenCalled();
		expect(unlink.mock.calls).toEqual([[temporary]]);
		expect(sync).toHaveBeenCalledTimes(1);
	});

	it('writes the same version-one bytes and synchronizes the directory after installation', async () => {
		await new Store(file).installVerified(plan, async () => {
			expect(sync).toHaveBeenCalledTimes(1);
		});
		expect(writeFile).toHaveBeenCalledWith(`${payload.toString()}\n`, 'utf8');
		expect(linkSync).toHaveBeenCalledWith(open.mock.calls[0]?.[0], file);
		expect(open).toHaveBeenNthCalledWith(2, '/mock', 'r');
		expect(sync).toHaveBeenCalledTimes(2);
	});

	it('confirms an installed plan after a failed install directory sync on restart', async () => {
		const events: string[] = [];
		sync.mockImplementationOnce(async () => { events.push('sync'); })
			.mockImplementationOnce(async () => {
				events.push('sync');
				throw new Error('directory sync failed');
			});
		await expect(new Store(file).installVerified(plan, async () => { events.push('install-lease'); }))
			.rejects.toThrow(/could not be made durable/);
		expect(linkSync).toHaveBeenCalledWith(open.mock.calls[0]?.[0], file);

		// A new store models restart: only the descriptor read establishes the inode
		// identity that may be durably confirmed by the next owner.
		sync.mockImplementationOnce(async () => { events.push('sync'); });
		const resumed = new Store(file);
		const recorded = await resumed.read();
		if (recorded === null) throw new Error('fixture must retain the installed plan');
		await resumed.confirmRecorded(recorded, async () => { events.push('resume-lease'); });
		expect(events).toEqual(['sync', 'install-lease', 'sync', 'sync', 'resume-lease']);
		expect(lstatSync).toHaveBeenCalledTimes(2);
	});
});
