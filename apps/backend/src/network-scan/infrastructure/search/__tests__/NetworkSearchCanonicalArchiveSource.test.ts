import { createHash } from 'node:crypto';
import {
	networkSearchCanonicalArchiveSql,
	PostgresNetworkSearchCanonicalArchiveSource
} from '../NetworkSearchCanonicalArchiveSource.js';

describe('PostgresNetworkSearchCanonicalArchiveSource', () => {
	it('uses archive identity rather than mutable scanner counters as its revision', async () => {
		const rows = [
			{
				archiveUrl: 'https://history-a.example',
				archiveUrlIdentity: 'https://history-a.example'
			},
			{
				archiveUrl: 'https://history-b.example',
				archiveUrlIdentity: 'https://history-b.example'
			}
		];
		const source = new PostgresNetworkSearchCanonicalArchiveSource({
			isInitialized: true,
			query: jest.fn().mockResolvedValue(rows)
		});

		await expect(source.load()).resolves.toEqual({
			revision: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
			roots: rows
		});
		expect(networkSearchCanonicalArchiveSql).not.toContain('"updatedAt"');
		expect(networkSearchCanonicalArchiveSql).not.toContain('"totalObjects"');
		expect(networkSearchCanonicalArchiveSql).not.toContain(
			'"verifiedCheckpointProofs"'
		);
	});
});
