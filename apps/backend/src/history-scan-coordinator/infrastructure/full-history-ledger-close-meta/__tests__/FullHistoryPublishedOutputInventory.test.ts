import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FullHistoryPublishedOutputInventory } from '../FullHistoryPublishedOutputInventory.js';

describe('FullHistoryPublishedOutputInventory', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'full-history-inventory-'));
	});

	afterEach(async () => {
		await rm(root, { force: true, recursive: true });
	});

	it('counts existing and newly published derived artifacts once', async () => {
		const existing = join(root, 'network', 'ledger-close-meta', '3-66');
		await mkdir(existing, { recursive: true });
		await writeFile(join(existing, 'manifest.json'), Buffer.alloc(11));
		const inventory = new FullHistoryPublishedOutputInventory(root);
		expect(await inventory.readStoredBytes()).toBe(11n);

		const published = join(root, 'network', 'ledger-close-meta', '67-130');
		await mkdir(published, { recursive: true });
		await writeFile(join(published, 'ledgers.parquet'), Buffer.alloc(17));
		await inventory.recordPublication(published, false);
		await inventory.recordPublication(published, true);
		expect(await inventory.readStoredBytes()).toBe(28n);
	});

	it('ignores a failed run that did not publish an output directory', async () => {
		const inventory = new FullHistoryPublishedOutputInventory(root);
		await inventory.recordPublication(join(root, 'missing'), false);
		expect(await inventory.readStoredBytes()).toBe(0n);
	});

	it('rejects special files instead of following them', async () => {
		await symlink('/tmp', join(root, 'escape'));
		const inventory = new FullHistoryPublishedOutputInventory(root);
		await expect(inventory.readStoredBytes()).rejects.toThrow(/special file/i);
	});
});
