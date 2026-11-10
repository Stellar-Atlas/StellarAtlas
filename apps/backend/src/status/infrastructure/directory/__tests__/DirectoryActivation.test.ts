import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';
import { StrKey } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import { createAccountDirectory } from '../DirectoryActivation.js';
import { directoryRouter } from '../../http/DirectoryRouter.js';
import { parseDirectoryImportManifest } from '../../../../core/infrastructure/cli/import-account-directory.js';
import { AccountDirectory1794090000000 } from '../../../../core/infrastructure/database/migrations/1794090000000-AccountDirectory.js';

const address = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 21));
const atlas = {
	address,
	name: 'Atlas fixture',
	tags: ['fixture'],
	network: 'mainnet',
	revision: 1,
	observedAt: '2026-11-07T20:00:00Z'
};
const pin = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };

it('is disabled by default without reading overlay configuration or querying storage', () => {
	const db = new DataSource({ type: 'postgres' });
	const transaction = jest.spyOn(db, 'transaction');
	expect(
		createAccountDirectory({ ACCOUNT_DIRECTORY_ATLAS_ENTRIES: '{invalid' }, db)
	).toBeUndefined();
	expect(
		createAccountDirectory({ ACCOUNT_DIRECTORY_ENABLED: 'false' }, db)
	).toBeUndefined();
	expect(transaction).not.toHaveBeenCalled();
	expect(() =>
		createAccountDirectory({ ACCOUNT_DIRECTORY_ENABLED: 'yes' }, db)
	).toThrow();
});

it('wires a lazy reader and serves separately attributed Atlas evidence through the real route', async () => {
	const db = new DataSource({ type: 'postgres' });
	const manager = {
		query: jest.fn().mockResolvedValue([]),
		findOneBy: jest.fn().mockResolvedValue(null)
	};
	const transaction = jest
		.spyOn(db, 'transaction')
		.mockImplementation(async (_level, work) =>
			work(manager as unknown as EntityManager)
		);
	const reader = createAccountDirectory(
		{
			ACCOUNT_DIRECTORY_ENABLED: 'true',
			ACCOUNT_DIRECTORY_ATLAS_ENTRIES: JSON.stringify([atlas])
		},
		db
	);
	expect(transaction).not.toHaveBeenCalled();
	if (!reader) throw new Error('Expected reader');
	const app = express().use('/directory', directoryRouter(reader));
	const result = await request(app)
		.get('/directory/' + address + '?network=mainnet')
		.expect('Cache-Control', 'no-store')
		.expect(200);
	expect(result.body.evidence).toMatchObject({
		address,
		network: 'mainnet',
		imported: null,
		atlas: {
			source: 'stellaratlas/overlay',
			publisher: 'StellarAtlas',
			name: 'Atlas fixture'
		}
	});
	expect(transaction).toHaveBeenCalledWith(
		'REPEATABLE READ',
		expect.any(Function)
	);
	expect(() =>
		createAccountDirectory(
			{
				ACCOUNT_DIRECTORY_ENABLED: 'true',
				ACCOUNT_DIRECTORY_ATLAS_ENTRIES: JSON.stringify([atlas, atlas])
			},
			db
		)
	).toThrow('Duplicate');
});

it('requires complete exact import pins and preserves the explicit snapshot/delta distinction', () => {
	const manifest = {
		mode: 'snapshot',
		approvedGitDir: '/approved/git',
		to: pin,
		observedAt: '2026-11-07T20:00:00Z'
	};
	expect(parseDirectoryImportManifest(manifest)).toEqual(manifest);
	expect(() =>
		parseDirectoryImportManifest({ ...manifest, from: pin })
	).toThrow();
	expect(() =>
		parseDirectoryImportManifest({ ...manifest, mode: 'delta' })
	).toThrow();
	expect(() =>
		parseDirectoryImportManifest({ ...manifest, to: { ...pin, tree: 'main' } })
	).toThrow();
	expect(() =>
		parseDirectoryImportManifest({ ...manifest, network: 'mainnet' })
	).toThrow();
});

it('adds only the two source-scoped tables and cursor index in a required transaction', async () => {
	const query = jest.fn().mockResolvedValue([]);
	const runner = { isTransactionActive: true, query } as unknown as QueryRunner;
	const migration = new AccountDirectory1794090000000();
	await migration.up(runner);
	const sql = query.mock.calls.map(([text]) => String(text)).join('\n');
	expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
	expect(sql).toContain('stellar-expert/public-directory');
	expect(sql).toContain('address COLLATE "C"');
	expect(sql).not.toContain('DROP ');
	await expect(
		migration.up({ ...runner, isTransactionActive: false } as QueryRunner)
	).rejects.toThrow('requires a transaction');
});
