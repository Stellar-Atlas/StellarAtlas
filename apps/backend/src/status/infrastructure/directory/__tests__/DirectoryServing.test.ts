import express from 'express';
import request from 'supertest';
import { StrKey } from '@stellar/stellar-sdk';
import {
	directoryRoutePrefix,
	directoryRouter
} from '../../http/DirectoryRouter.js';
import {
	DirectoryReader,
	type ImportedDirectoryReader
} from '../DirectoryReader.js';
import type {
	ExpertDirectoryCheckpoint,
	ExpertDirectoryEntry
} from '../ExpertDirectoryImport.js';
import { EXPERT_DIRECTORY_SOURCE } from '../ExpertDirectoryRecord.js';

const observedAt = '2026-11-04T20:30:00.000Z';
const commit = 'a'.repeat(40);
const blob = 'b'.repeat(40);
const checkpoint: ExpertDirectoryCheckpoint = {
	commit,
	observedAt,
	previousCommit: null,
	deltaSha256: null
};
const [first, second, third, fourth, absent] = Array.from(
	{ length: 5 },
	(_, index) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, index + 1))
).sort() as [string, string, string, string, string];

function active(
	address: string,
	name: string,
	domain: string
): ExpertDirectoryEntry {
	return {
		address,
		addressKind: 'account',
		source: EXPERT_DIRECTORY_SOURCE,
		publisher: 'StellarExpert',
		license: 'MIT',
		networkApplicability: 'unspecified',
		name,
		domain,
		tags: ['custodian'],
		sourcePath: `accounts/${address}.json`,
		sourceBlobOid: blob,
		version: 1,
		contentSha256: 'c'.repeat(64),
		commit,
		observedAt,
		state: 'active'
	};
}

function fixture(current: ExpertDirectoryCheckpoint | null = checkpoint) {
	const tombstone: ExpertDirectoryEntry = {
		address: second,
		addressKind: 'account',
		source: EXPERT_DIRECTORY_SOURCE,
		state: 'deleted',
		sourcePath: `accounts/${second}.json`,
		previousBlobOid: blob,
		commit,
		observedAt
	};
	const rows = [
		{
			...active(first, 'Expert Label', 'stellar.org'),
			extraPrivateField: 'omitted'
		},
		tombstone,
		active(third, 'Atlas Named by Expert', 'third.example'),
		active(fourth, 'Unrelated Name', 'atlas-domain.example')
	];
	const lookup = jest.fn<
		ReturnType<ImportedDirectoryReader['lookup']>,
		[string]
	>(async (address) => ({
		checkpoint: current,
		entries: rows.filter((row) => row.address === address)
	}));
	const search = jest.fn<
		ReturnType<ImportedDirectoryReader['search']>,
		Parameters<ImportedDirectoryReader['search']>
	>(async ({ prefix, after, take, atlasAddresses }) => ({
		checkpoint: current,
		entries: rows
			.filter(
				(row) =>
					row.address > after &&
					(atlasAddresses.includes(row.address) ||
						(row.state === 'active' &&
							[row.address, row.name, row.domain].some((value) =>
								value?.toLowerCase().startsWith(prefix)
							)))
			)
			.slice(0, take)
	}));
	const app = express();
	app.use(
		directoryRoutePrefix,
		directoryRouter(
			new DirectoryReader({ lookup, search }, [
				{
					address: first,
					name: 'Atlas Mainnet',
					domain: 'atlas.example',
					tags: [],
					network: 'mainnet',
					revision: 2,
					observedAt
				},
				{
					address: first,
					name: 'Expert Label',
					domain: 'stellar.org',
					tags: [],
					network: 'testnet',
					revision: 1,
					observedAt
				},
				{
					address: second,
					name: 'Atlas Tombstone Pair',
					tags: [],
					network: 'mainnet',
					revision: 1,
					observedAt
				}
			])
		)
	);
	return { app, lookup, search };
}

describe('account directory routes', () => {
	it('returns attributed observations and conflicts separately for the requested network', async () => {
		const { app } = fixture();
		const path = directoryRoutePrefix + '/' + first;
		const main = await request(app)
			.get(path)
			.query({ network: 'mainnet' })
			.expect(200);
		expect(main.body).toMatchObject({
			upstream: {
				source: EXPERT_DIRECTORY_SOURCE,
				publisher: 'StellarExpert',
				license: 'MIT',
				copyright: 'Copyright (c) 2022 StellarExpert',
				checkpoint,
				refreshState: 'imported',
				networkApplicability: 'unspecified'
			},
			evidence: {
				address: first,
				network: 'mainnet',
				conflicts: ['name', 'domain'],
				imported: {
					name: 'Expert Label',
					sourceBlobOid: blob,
					networkApplicability: 'unspecified'
				},
				atlas: {
					name: 'Atlas Mainnet',
					source: 'stellaratlas/overlay',
					revision: 2
				}
			}
		});
		expect(main.body.upstream.licenseUrl).toMatch(
			/\/blob\/[a-f0-9]{40}\/LICENSE$/
		);
		expect(main.body.evidence.imported).not.toHaveProperty('extraPrivateField');
		const test = await request(app)
			.get(path)
			.query({ network: 'testnet' })
			.expect(200);
		expect(test.body.evidence.conflicts).toEqual([]);
		expect(test.body.evidence.imported).toEqual(main.body.evidence.imported);
		expect(test.body.evidence.atlas).toMatchObject({
			name: 'Expert Label',
			networkApplicability: 'testnet'
		});
	});

	it('paginates the merged prefix search and pairs tombstones with matching Atlas labels', async () => {
		const { app, search } = fixture();
		const q = { network: 'mainnet', q: 'ATLAS', limit: '2' };
		const page = await request(app)
			.get(directoryRoutePrefix)
			.query(q)
			.expect(200);
		expect(
			page.body.items.map((item: { address: string }) => item.address)
		).toEqual([first, second]);
		expect(page.body.items[0].imported).toMatchObject({ name: 'Expert Label' });
		expect(page.body.items[1]).toMatchObject({
			imported: { state: 'deleted', previousBlobOid: blob },
			atlas: { name: 'Atlas Tombstone Pair' },
			conflicts: []
		});
		expect(page.body.nextCursor).toBe(second);
		expect(search).toHaveBeenLastCalledWith({
			prefix: 'atlas',
			after: '',
			take: 3,
			atlasAddresses: [first, second]
		});
		const next = await request(app)
			.get(directoryRoutePrefix)
			.query({ ...q, cursor: second })
			.expect(200);
		expect(
			next.body.items.map((item: { address: string }) => item.address)
		).toEqual([third, fourth]);
		expect(next.body.nextCursor).toBeNull();
		const byAddress = await request(app)
			.get(directoryRoutePrefix)
			.query({
				network: 'testnet',
				q: first.toLowerCase()
			})
			.expect(200);
		expect(
			byAddress.body.items.map((item: { address: string }) => item.address)
		).toEqual([first]);
	});

	it('distinguishes an uninitialized source and preserves independent Atlas evidence', async () => {
		const { app } = fixture(null);
		const result = await request(app)
			.get(directoryRoutePrefix + '/' + first)
			.query({ network: 'mainnet' })
			.expect(200);
		expect(result.body).toMatchObject({
			evidence: { imported: null, atlas: { name: 'Atlas Mainnet' } },
			upstream: { refreshState: 'uninitialized', checkpoint: null }
		});
		const search = await request(app)
			.get(directoryRoutePrefix)
			.query({ network: 'mainnet', q: 'atlas' })
			.expect(200);
		expect(
			search.body.items.map((item: { address: string }) => item.address)
		).toEqual([first, second]);
		const initialized = fixture();
		const empty = await request(initialized.app)
			.get(directoryRoutePrefix + '/' + absent)
			.query({ network: 'mainnet' })
			.expect(200);
		expect(empty.body).toMatchObject({
			evidence: { address: absent, imported: null, atlas: null },
			upstream: { refreshState: 'imported', checkpoint }
		});
	});

	it('rejects invalid or repeated filters before reading the source and sanitizes failures', async () => {
		const { app, lookup, search } = fixture();
		for (const suffix of [
			'?q=atlas',
			'?network=other&q=atlas',
			'?network=mainnet&q=ab',
			'?network=mainnet&q=atlas&q=expert',
			'?network=mainnet&q=atlas&limit=51',
			'?network=mainnet&q=atlas&limit=1%0A',
			'?network=mainnet&q=atlas&cursor=invalid',
			'/bad-address?network=testnet'
		]) {
			await request(app)
				.get(directoryRoutePrefix + suffix)
				.expect(400);
		}
		expect(lookup).not.toHaveBeenCalled();
		expect(search).not.toHaveBeenCalled();
		lookup.mockRejectedValueOnce(new Error('internal query contents'));
		const unavailable = await request(app)
			.get(directoryRoutePrefix + '/' + first)
			.query({ network: 'mainnet' })
			.expect(503);
		expect(unavailable.body).toEqual({
			code: 'directory_unavailable',
			error: 'Account directory is temporarily unavailable'
		});
	});
});
