import { DirectoryReader } from './DirectoryReader.js';
import { TypeOrmDirectoryReader } from './TypeOrmDirectoryReader.js';
import type { DataSource } from 'typeorm';
import { createAtlasDirectoryEntry } from './DirectoryEvidence.js';

/** Only explicit opt-in admits directory reads; importing remains an operator action. */
export function createAccountDirectory(
	environment: Readonly<Record<string, string | undefined>>,
	dataSource: DataSource
): DirectoryReader | undefined {
	const enabled = environment.ACCOUNT_DIRECTORY_ENABLED;
	if (enabled === undefined || enabled === 'false') return undefined;
	if (enabled !== 'true')
		throw new Error('ACCOUNT_DIRECTORY_ENABLED must be true or false');
	const json = environment.ACCOUNT_DIRECTORY_ATLAS_ENTRIES ?? '[]';
	if (Buffer.byteLength(json) > 256 * 1024)
		throw new Error('Atlas directory configuration exceeds its byte limit');
	const entries: unknown = JSON.parse(json);
	if (!Array.isArray(entries) || entries.length > 1024)
		throw new Error('Atlas directory configuration must be a bounded array');
	const parsed = entries.map((value: unknown) => {
		if (typeof value !== 'object' || value === null || Array.isArray(value))
			throw new Error('Invalid Atlas directory entry');
		const row = value as Record<string, unknown>;
		if (
			Object.keys(row).some(
				(key) =>
					![
						'address',
						'name',
						'domain',
						'tags',
						'network',
						'revision',
						'observedAt'
					].includes(key)
			)
		)
			throw new Error('Unknown Atlas directory entry field');
		return createAtlasDirectoryEntry({
			address: typeof row.address === 'string' ? row.address : '',
			name: typeof row.name === 'string' ? row.name : '',
			domain: row.domain as string | null | undefined,
			tags: row.tags as readonly string[],
			network: row.network as 'mainnet' | 'testnet',
			revision: row.revision as number,
			observedAt: row.observedAt as string
		});
	});
	// The reader validates duplicate addresses and networks as well as public fields.
	return new DirectoryReader(
		new TypeOrmDirectoryReader(dataSource),
		parsed.map((entry) => ({
			...entry,
			network: entry.networkApplicability
		}))
	);
}
