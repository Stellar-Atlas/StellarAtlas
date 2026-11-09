import {
	assertPairedCapacity,
	fencePairedCurrentAdmission,
	matchesFullPublication,
	type PairedCurrentAdmissionPolicy,
	type PairedFilesystem
} from '../FullHistoryPairedCurrentAdmission.js';
import type { PendingPlan } from '../FullHistoryLedgerCloseMetaPendingPlan.js';
import fsModule, { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readScopedCurrentArm, type ScopedCurrentAttemptPolicy } from '../FullHistoryScopedCurrentAttempt.js';

describe('paired current source admission', () => {
	const policy: PairedCurrentAdmissionPolicy = {
		bootId: 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd',
		warehouseReportedPath: '/bulk/warehouse',
		warehouseMetadataPath: '/run/warehouse-metadata',
		warehouseMetadataInode: 12n,
		minimumUnreservedBytes: 800n
	};
	const config = { bulkRoot: '/bulk', typedOutputRoot: '/bulk/source',
		currentMinimumFreeBytes: 500n, minimumFreeBasisPoints: 500, sourceOutputBytes: 100n };
	const before: PairedFilesystem = { device: 4n, inode: 1n, total: 10_000n, available: 1_001n };
	const warehouse = { ...before, inode: 12n, available: 1_000n };
	const row = { path: '/bulk/warehouse/', total_space: '10000', free_space: '1000', unreserved_space: '800' };

	it.each(['assertCapacity', 'pendingPublication'] as const)(
		'fails %s when the lock session is lost during metadata I/O', async method => {
			const pending: PendingPlan = {
				version: 1, kind: 'priority', networkPassphraseHash: '22'.repeat(32),
				sourceId: 'source', configDigest: '11'.repeat(32),
				partitionVersion: 'source-aligned-remainder-v1', sourceBatchLedgerCount: 1,
				typedShardLedgerCount: 64, startLedger: 3, endLedger: 66,
				shards: [{ startLedger: 3, endLedger: 66 }]
			};
			const actions: string[] = [];
			let held = true;
			const read = async () => {
				actions.push('metadata');
				await Promise.resolve();
				held = false;
			};
			const fenced = fencePairedCurrentAdmission({
				assertCapacity: read,
				pendingPublication: async () => { await read(); return 'published'; }
			}, async () => {
				actions.push('lease');
				if (!held) throw new Error('leadership lost');
			});
			await expect(fenced[method](pending, new AbortController().signal)).rejects.toThrow(/leadership lost/);
			expect(actions).toEqual(['lease', 'metadata', 'lease']);
		});

	it('counts existing warehouse reservations once and rejects stale or mismatched capacity', () => {
		expect(() => assertPairedCapacity(policy, config, before, before, before, warehouse, row, 4000))
			.not.toThrow();
		expect(() => assertPairedCapacity(policy, config, before, before, before, warehouse, row, 4001))
			.toThrow(/expired/);
		expect(() => assertPairedCapacity(policy, config, before, before, before, { ...warehouse, device: 5n }, row, 5))
			.toThrow(/mismatch/);
		expect(() => assertPairedCapacity(policy, config, before, before, before, warehouse, {
			...row, path: '/bulk/link/../warehouse'
		}, 5)).toThrow(/mismatch/);
		expect(() => assertPairedCapacity(policy, config, before, { ...before, available: 999n }, before, warehouse, row, 5))
			.toThrow(/reserve refused/);
	});

	it('keeps all 328 GiB above the scoped floor and refuses another bulk device', () => {
		const start = 3_375_844_294_656n;
		const disk = { ...before, total: 64_000_911_998_976n, available: start };
		const reservedPolicy = { ...policy, minimumUnreservedBytes: start };
		const scoped = { ...config, scopedBulkDevice: disk.device };
		const available = { ...row, total_space: String(disk.total), free_space: String(start),
			unreserved_space: String(start) };
		const check = (policyValue = reservedPolicy, cfg = scoped, rowValue = available) =>
			assertPairedCapacity(policyValue, cfg, disk, disk, disk, { ...disk, inode: 12n }, rowValue, 1);
		expect(() => check()).not.toThrow();
		expect(() => check({ ...reservedPolicy, minimumUnreservedBytes: start - 1n })).toThrow(/floor/);
		expect(() => check(reservedPolicy, { ...scoped, scopedBulkDevice: 5n })).toThrow(/bulk device/);
		expect(() => check(reservedPolicy, scoped, { ...available, unreserved_space: String(start - 1n) })).toThrow(/reserve refused/);
	});

	it('requires one exact completed manifest with the same source digest, range and all 20 dataset counts', () => {
		const source = { id: '00', digest: 'aa'.repeat(32), start: 100, end: 163 };
		const datasets = {
			account_signers: '0', accounts: '0', claimable_balances: '0', config_settings: '0',
			contract_code: '0', contract_data: '0', history_assets: '0', history_contract_events: '0',
			history_effects: '0', history_ledgers: '64', history_operations: '0', history_trades: '0',
			history_transactions: '0', ledger_transactions: '0', liquidity_pools: '0', offers: '0',
			restored_key: '0', token_transfers: '0', trustlines: '0', ttl: '0'
		};
		const manifest = { id: source.id, digest: source.digest, start_ledger: 100, end_ledger: 163,
			ledger_count: 64, status: 'complete', projection_contract: 'hubble-full20-v1', datasets };
		expect(matchesFullPublication(manifest, source)).toBe(true);
		expect(matchesFullPublication({ ...manifest, digest: 'bb'.repeat(32) }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, end_ledger: 164 }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, status: 'started' }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, datasets: { ...datasets, ttl: undefined } }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, datasets: { ...datasets, history_ledgers: '63' } }, source)).toBe(false);
	});
});

describe('scoped current-attempt arm binding', () => {
	it('binds invocation and rejects a same-content hold inode swap at the gate', async () => {
		const permitId = '123e4567-e89b-42d3-a456-426614174000';
		const bootId = 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd';
		const invocationId = 'a'.repeat(32);
		const entryPath = fileURLToPath(new URL('../run-continuous-full-history-ledger-close-meta.js', import.meta.url));
		const entryBytes = Buffer.from('trusted entrypoint');
		const holdBytes = Buffer.from('held');
		const policy: ScopedCurrentAttemptPolicy = { permitId, bulkDevice: 7n, startLedger: 65_366_208, endLedger: 65_366_335 };
		const expiry = '2026-11-09T18:10:00.000Z';
		let nowMs = Date.parse('2026-11-09T18:00:00.000Z');
		let holdInode = 22n;
		const fileBytes = new Map<string, Buffer>();
		const fakeFileStat = (filePath: string) => {
			const data = fileBytes.get(filePath)!;
			const inode = filePath.endsWith('/hold') ? holdInode : filePath === entryPath ? 33n : 44n;
			return { dev: 1n, ino: inode, uid: 0n, gid: 0n, mode: 0o100444n, nlink: 1n,
				size: BigInt(data.length), ctimeNs: 1n, mtimeNs: 1n,
				isFile: () => true, isDirectory: () => false };
		};
		const dirStat = (inode: bigint) => ({ dev: 1n, ino: inode, uid: 0n, gid: 0n, mode: 0o40755n,
			isDirectory: () => true, isFile: () => false });
		const arm = () => JSON.stringify({ version: 1, permitId, bootId, invocationId, bulkDevice: '7',
			startLedger: policy.startLedger, endLedger: policy.endLedger, entryPath,
			entrySha256: createHash('sha256').update(entryBytes).digest('hex'), expiresAt: expiry,
			holdDevice: '1', holdInode: '22', holdSha256: createHash('sha256').update(holdBytes).digest('hex') });
		fileBytes.set(entryPath, entryBytes);
		fileBytes.set('/run/stellaratlas-history-admission/hold', holdBytes);
		fileBytes.set('/run/stellaratlas-history-admission/current-attempt.json', Buffer.from(arm()));
		const realpath = jest.spyOn(fs, 'realpath').mockImplementation(async target => String(target));
		const lstat = jest.spyOn(fs, 'lstat').mockImplementation(async target => {
			const targetPath = String(target);
			if (targetPath === '/run') return dirStat(1n) as never;
			if (targetPath === '/run/stellaratlas-history-admission') return dirStat(2n) as never;
			return fakeFileStat(targetPath) as never;
		});
		const statfs = jest.spyOn(fs, 'statfs').mockResolvedValue({ type: 0x01021994n } as never);
		const lstatSync = jest.spyOn(fsModule, 'lstatSync').mockImplementation(target => fakeFileStat(String(target)) as never);
		const readFile = jest.spyOn(fs, 'readFile').mockResolvedValue(bootId as never);
		const open = jest.spyOn(fs, 'open').mockImplementation(async target => {
			const targetPath = String(target);
			const bytes = fileBytes.get(targetPath)!;
			const handle = {
				stat: async () => fakeFileStat(targetPath), close: async () => undefined,
				read: async (buffer: Buffer, offset: number, length: number, position: number | null) => {
					const readPosition = position ?? 0;
					const count = Math.min(length, bytes.length - readPosition);
					if (count > 0) bytes.copy(buffer, offset, readPosition, readPosition + count);
					return { bytesRead: count, buffer };
				},
			};
			return handle as never;
		});
		try {
			const gate = await readScopedCurrentArm(policy, bootId, invocationId, entryPath, () => nowMs);
			expect(gate).toEqual(expect.any(Function));
			await expect(readScopedCurrentArm(policy, bootId, invocationId, '/unexpected/entry.js', () => nowMs)).resolves.toBeNull();
			expect(realpath).not.toHaveBeenCalledWith('/unexpected/entry.js');
			expect(await gate!()).not.toThrow();
			// The invocation is part of the arm binding.
			expect(await readScopedCurrentArm(policy, bootId, 'b'.repeat(32), entryPath, () => nowMs)).toBeNull();
			lstatSync.mockImplementationOnce(target => {
				nowMs = Date.parse(expiry);
				return fakeFileStat(String(target)) as never;
			});
			expect(await gate!()).toThrow(/no longer valid/);
			nowMs -= 10_000;
			holdInode = 23n;
			await expect(gate!()).rejects.toThrow(/no longer valid/);
		} finally {
			open.mockRestore(); readFile.mockRestore(); lstatSync.mockRestore(); statfs.mockRestore(); lstat.mockRestore(); realpath.mockRestore();
		}
	});
});
