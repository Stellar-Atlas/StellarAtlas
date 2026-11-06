import { jest } from '@jest/globals';
import {
	chmod,
	link,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	symlink,
	utimes,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import { AssetCatalogue } from '../AssetCatalogue.js';
import { AssetCatalogueFiles } from '../AssetCatalogueFiles.js';
import { AssetCatalogueSource } from '../AssetCatalogueSource.js';

const outsideContents = JSON.stringify({
	version: 1,
	generatedAt: 'outside',
	assets: []
});

describe('asset catalogue filesystem boundary', () => {
	let workspace: string;
	let directory: string;
	let outside: string;
	let sentinel: string;

	beforeEach(async () => {
		workspace = await realpath(
			await mkdtemp(join(tmpdir(), 'asset-catalogue-files-'))
		);
		directory = join(workspace, 'catalogue');
		outside = join(workspace, 'outside');
		sentinel = join(outside, 'catalogue.json');
		await mkdir(outside, { mode: 0o700 });
		await writeFile(sentinel, outsideContents, { mode: 0o600 });
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		await rm(workspace, { recursive: true, force: true });
	});

	function catalogue(root = directory) {
		const source = new AssetCatalogueSource(Networks.PUBLIC, {
			HUBBLE_CLICKHOUSE_URL: 'http://127.0.0.1:8123'
		});
		const refresh = jest.spyOn(source, 'refresh').mockResolvedValue({
			assets: [],
			watermark: '2026-10-13 01:00:00.000000',
			maxLedger: 42
		});
		return {
			catalogue: new AssetCatalogue(source, root, Networks.PUBLIC),
			refresh
		};
	}

	it('rejects relative, noncanonical and missing-parent destinations', async () => {
		await expect(AssetCatalogueFiles.open('catalogue', true)).rejects.toThrow(
			'canonical'
		);
		await expect(
			AssetCatalogueFiles.open(workspace + sep + '..' + sep + 'catalogue', true)
		).rejects.toThrow('canonical');
		await expect(
			AssetCatalogueFiles.open(join(workspace, 'missing', 'catalogue'), true)
		).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await readdir(workspace)).toEqual(['outside']);
		expect(await readFile(sentinel, 'utf8')).toBe(outsideContents);
	});

	it('refuses symlinked roots and ancestors before touching the target', async () => {
		await symlink(
			outside,
			directory,
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		await expect(AssetCatalogueFiles.open(directory, true)).rejects.toThrow(
			'Unsafe'
		);
		await expect(
			AssetCatalogueFiles.open(join(directory, 'nested'), true)
		).rejects.toThrow('Unsafe');
		expect(await readdir(outside)).toEqual(['catalogue.json']);
		expect(await readFile(sentinel, 'utf8')).toBe(outsideContents);
	});

	it('rejects a multiply linked snapshot and does not read or refresh it', async () => {
		await mkdir(directory, { mode: 0o700 });
		await link(sentinel, join(directory, 'catalogue.json'));
		const candidate = catalogue();
		const logger = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		await candidate.catalogue.load();
		expect(logger).toHaveBeenCalled();
		expect(
			candidate.catalogue.cachedIssuerObservationsSnapshot().generatedAt
		).toBeNull();
		await expect(candidate.catalogue.refresh()).rejects.toThrow(
			'Unsafe asset catalogue file'
		);
		expect(candidate.refresh).not.toHaveBeenCalled();
		expect(await readFile(sentinel, 'utf8')).toBe(outsideContents);
	});

	const posix = process.getuid ? it : it.skip;
	posix('rejects a writable directory and writable ancestors', async () => {
		await mkdir(directory, { mode: 0o700 });
		await chmod(directory, 0o777);
		await expect(AssetCatalogueFiles.open(directory, true)).rejects.toThrow(
			'Unsafe'
		);
		await expect(
			AssetCatalogueFiles.open(join(directory, 'nested'), true)
		).rejects.toThrow('Unsafe');
		expect(await readFile(sentinel, 'utf8')).toBe(outsideContents);
	});

	posix(
		'refuses linked snapshot and stale lock leaves; never follows an old temp name',
		async () => {
			await mkdir(directory, { mode: 0o700 });
			const snapshot = join(directory, 'catalogue.json');
			const lock = join(directory, 'catalogue.lock');
			const oldTemp = join(directory, 'catalogue.' + process.pid + '.tmp');
			const candidate = catalogue();
			const logger = jest
				.spyOn(console, 'error')
				.mockImplementation(() => undefined);
			await symlink(sentinel, snapshot);
			await candidate.catalogue.load();
			expect(logger).toHaveBeenCalled();
			expect(
				candidate.catalogue.cachedIssuerObservationsSnapshot().generatedAt
			).toBeNull();
			await expect(candidate.catalogue.refresh()).rejects.toThrow(
				'Unsafe asset catalogue file'
			);
			await rm(snapshot);
			await symlink(sentinel, lock);
			const stale = new Date(Date.now() - 901_000);
			await utimes(sentinel, stale, stale);
			await expect(candidate.catalogue.refresh()).rejects.toThrow(
				'Unsafe asset catalogue file'
			);
			expect((await lstat(lock)).isSymbolicLink()).toBe(true);
			expect(candidate.refresh).not.toHaveBeenCalled();
			await rm(lock);
			await symlink(sentinel, oldTemp);
			await expect(candidate.catalogue.refresh()).resolves.toBe(true);
			expect((await lstat(oldTemp)).isSymbolicLink()).toBe(true);
			expect((await lstat(snapshot)).mode & 0o777).toBe(0o600);
			expect((await readdir(directory)).sort()).toEqual(
				[oldTemp.slice(directory.length + 1), 'catalogue.json'].sort()
			);
			expect(await readFile(sentinel, 'utf8')).toBe(outsideContents);
		}
	);

	it('keeps fresh locks, reclaims stale ordinary locks, and atomically reloads the snapshot', async () => {
		await mkdir(directory, { mode: 0o700 });
		const lock = join(directory, 'catalogue.lock');
		await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
		const candidate = catalogue();
		await expect(candidate.catalogue.refresh()).resolves.toBe(false);
		expect(candidate.refresh).not.toHaveBeenCalled();
		const stale = new Date(Date.now() - 901_000);
		await utimes(lock, stale, stale);
		await expect(candidate.catalogue.refresh()).resolves.toBe(true);
		expect(candidate.refresh).toHaveBeenCalledTimes(1);
		expect(await readdir(directory)).toEqual(['catalogue.json']);
		const reader = catalogue();
		await reader.catalogue.load();
		expect(
			reader.catalogue.cachedIssuerObservationsSnapshot().generatedAt
		).toEqual(expect.any(String));
		expect(reader.refresh).not.toHaveBeenCalled();
	});

	async function beginRefresh() {
		const first = catalogue();
		let finish!: (
			value: Awaited<ReturnType<AssetCatalogueSource['refresh']>>
		) => void;
		let entered!: () => void;
		const inRefresh = new Promise<void>((resolve) => {
			entered = resolve;
		});
		first.refresh.mockImplementationOnce(() => {
			entered();
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const running = first.catalogue.refresh();
		await Promise.race([inRefresh, running]);
		return {
			running,
			finish: () => finish({ assets: [], watermark: undefined, maxLedger: 0 })
		};
	}

	it('keeps concurrent refresh single-owner', async () => {
		const { running, finish } = await beginRefresh();
		const second = catalogue();
		try {
			await expect(second.catalogue.refresh()).resolves.toBe(false);
			expect(second.refresh).not.toHaveBeenCalled();
		} finally {
			finish();
			await running;
		}
		expect(await readdir(directory)).toEqual([]);
	});

	posix('does not remove a replacement lock on release', async () => {
		const { running, finish } = await beginRefresh();
		try {
			const lock = join(directory, 'catalogue.lock');
			const replacement = join(directory, 'replacement');
			await writeFile(replacement, 'another owner', {
				flag: 'wx',
				mode: 0o600
			});
			await rename(replacement, lock);
		} finally {
			finish();
			await running;
		}
		expect(await readFile(join(directory, 'catalogue.lock'), 'utf8')).toBe(
			'another owner'
		);
	});

	it('retains the ten-second read cooldown while fresh readers see the next snapshot', async () => {
		const writer = catalogue();
		await writer.catalogue.refresh();
		const reader = catalogue();
		await reader.catalogue.load();
		const original =
			reader.catalogue.cachedIssuerObservationsSnapshot().generatedAt;
		const nextTime = Date.now() + 20_000;
		const files = await AssetCatalogueFiles.open(directory, false);
		expect(files).toBeDefined();
		await files!.replaceSnapshot(
			JSON.stringify({ version: 1, generatedAt: 'next', assets: [] })
		);
		const nextSnapshot = join(directory, 'catalogue.json');
		await utimes(nextSnapshot, new Date(nextTime), new Date(nextTime));
		await reader.catalogue.load();
		expect(
			reader.catalogue.cachedIssuerObservationsSnapshot().generatedAt
		).toBe(original);
		const fresh = catalogue();
		await fresh.catalogue.load();
		expect(fresh.catalogue.cachedIssuerObservationsSnapshot().generatedAt).toBe(
			'next'
		);
		jest.spyOn(Date, 'now').mockReturnValue(nextTime);
		await reader.catalogue.load();
		expect(
			reader.catalogue.cachedIssuerObservationsSnapshot().generatedAt
		).toBe('next');
	});
});
