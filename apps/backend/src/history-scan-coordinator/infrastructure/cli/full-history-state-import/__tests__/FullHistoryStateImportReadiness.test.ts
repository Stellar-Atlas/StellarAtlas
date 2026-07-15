import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { checkFullHistoryStateImportReadiness } from '../FullHistoryStateImportReadiness.js';

interface NameRow {
	readonly name: string;
}

describe('FullHistoryStateImportReadiness', () => {
	let executablePath: string;
	let root: string;
	let storageRoot: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'state-import-readiness-'));
		storageRoot = join(root, 'typed');
		executablePath = join(root, 'exporter');
		await mkdir(storageRoot);
		await writeFile(executablePath, 'test executable');
		await chmod(executablePath, 0o700);
	});

	afterEach(async () => {
		await rm(root, { force: true, recursive: true });
	});

	it('accepts an applied, structurally complete schema and runtime paths', async () => {
		const { dataSource, queryCalls } = createDataSource(false);
		await expect(
			checkFullHistoryStateImportReadiness(dataSource, {
				executablePath,
				storageRoot
			})
		).resolves.toEqual({
			missingRuntimeObjects: [],
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		});
		expect(queryCalls).toHaveLength(6);
	});

	it('fails closed for pending migrations and every missing schema class', async () => {
		const { dataSource } = createDataSource(true, [
			[{ name: 'full_history_lcm_state_import' }],
			[{ name: 'full_history_lcm_state_import.status' }],
			[{ name: 'chk_full_history_lcm_state_import_lifecycle' }],
			[
				{
					name: 'full_history_lcm_state_import.trg_reject_full_history_lcm_completed_import_mutation'
				}
			],
			[{ name: 'reject_full_history_lcm_completed_import_mutation()' }],
			[
				{
					name: 'full_history_lcm_state_import.idx_full_history_lcm_state_import_claim'
				}
			]
		]);
		await expect(
			checkFullHistoryStateImportReadiness(dataSource, {
				executablePath,
				storageRoot
			})
		).resolves.toEqual({
			missingRuntimeObjects: [],
			missingSchemaObjects: [
				'column:full_history_lcm_state_import.status',
				'constraint:chk_full_history_lcm_state_import_lifecycle',
				'function:reject_full_history_lcm_completed_import_mutation()',
				'index:full_history_lcm_state_import.idx_full_history_lcm_state_import_claim',
				'relation:full_history_lcm_state_import',
				'trigger:full_history_lcm_state_import.trg_reject_full_history_lcm_completed_import_mutation'
			],
			pendingMigrations: true,
			ready: false
		});
	});

	it('fails closed when the executable and storage root are absent', async () => {
		const { dataSource } = createDataSource(false);
		await expect(
			checkFullHistoryStateImportReadiness(dataSource, {
				executablePath: join(root, 'missing-exporter'),
				storageRoot: join(root, 'missing-storage')
			})
		).resolves.toEqual({
			missingRuntimeObjects: [
				'executable:missing-or-inaccessible',
				'storage-root:missing-or-inaccessible'
			],
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: false
		});
	});
});

function createDataSource(
	pendingMigrations: boolean,
	responses: readonly (readonly NameRow[])[] = []
): {
	readonly dataSource: DataSource;
	readonly queryCalls: number[];
} {
	let responseIndex = 0;
	const queryCalls: number[] = [];
	const query = async (): Promise<readonly NameRow[]> => {
		const response = responses[responseIndex] ?? [];
		queryCalls.push(responseIndex);
		responseIndex += 1;
		return response;
	};
	return {
		dataSource: {
			query,
			showMigrations: async () => pendingMigrations
		} as unknown as DataSource,
		queryCalls
	};
}
