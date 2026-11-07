import { StrKey } from '@stellar/stellar-sdk';
import official from './fixtures/stellar-expert-directory/record.json' with { type: 'json' };
import {
	ATLAS_DIRECTORY_SOURCE,
	createAtlasDirectoryEntry,
	projectDirectoryEvidence
} from '../DirectoryEvidence.js';
import type { ExpertDirectoryEntry } from '../ExpertDirectoryImport.js';
import { parseExpertDirectoryRecord } from '../ExpertDirectoryRecord.js';

const observedAt = '2026-11-04T19:00:00.000Z';
const imported = {
	...parseExpertDirectoryRecord(
		official.path,
		official.blobOid,
		Buffer.from(official.contentBase64, 'base64')
	),
	commit: official.commit,
	observedAt,
	state: 'active'
} as const;
const atlasDraft = {
	address: imported.address,
	network: 'mainnet',
	name: 'Atlas curated label',
	domain: 'example.org',
	tags: ['atlas-review'],
	revision: 3,
	observedAt
} as const;

test('projects competing labels and domains with both sources and their own tags', () => {
	const atlas = createAtlasDirectoryEntry(atlasDraft);
	const result = projectDirectoryEvidence(
		imported.address,
		'mainnet',
		imported,
		atlas
	);
	expect(result).toEqual({
		address: imported.address,
		addressKind: 'account',
		network: 'mainnet',
		imported,
		atlas,
		conflicts: ['name', 'domain']
	});
	expect(result.atlas).toMatchObject({
		source: ATLAS_DIRECTORY_SOURCE,
		publisher: 'StellarAtlas',
		revision: 3,
		networkApplicability: 'mainnet',
		tags: ['atlas-review']
	});
	expect(result.imported).toMatchObject({
		source: 'stellar-expert/public-directory',
		networkApplicability: 'unspecified',
		tags: ['custodian', 'sdf'],
		commit: official.commit
	});
});

test('an absent optional domain does not become a conflicting claim', () => {
	const atlas = createAtlasDirectoryEntry({
		...atlasDraft,
		name: imported.name,
		domain: null
	});
	expect(
		projectDirectoryEvidence(imported.address, 'mainnet', imported, atlas)
			.conflicts
	).toEqual([]);
});

test('an imported tombstone keeps provenance alongside the independent Atlas revision', () => {
	const atlas = createAtlasDirectoryEntry(atlasDraft);
	const deleted: ExpertDirectoryEntry = {
		state: 'deleted',
		address: imported.address,
		addressKind: 'account',
		source: imported.source,
		sourcePath: imported.sourcePath,
		previousBlobOid: imported.sourceBlobOid,
		commit: 'a'.repeat(40),
		observedAt
	};
	const result = projectDirectoryEvidence(
		imported.address,
		'mainnet',
		deleted,
		atlas
	);
	expect(result.imported).toBe(deleted);
	expect(result.atlas).toBe(atlas);
	expect(result.conflicts).toEqual([]);
	expect(result.imported).not.toHaveProperty('name');
});

test('binds the overlay to an exact address and requested network', () => {
	const atlas = createAtlasDirectoryEntry(atlasDraft);
	const other = StrKey.encodeContract(Buffer.alloc(32, 13));
	expect(() =>
		projectDirectoryEvidence(other, 'mainnet', imported, null)
	).toThrow('does not match the address');
	expect(() =>
		projectDirectoryEvidence(imported.address, 'testnet', imported, atlas)
	).toThrow('does not match the address or network');
	expect(
		projectDirectoryEvidence(imported.address, 'testnet', imported, null)
			.imported
	).toBe(imported);
	expect(() =>
		createAtlasDirectoryEntry({ ...atlasDraft, address: 'C' + 'A'.repeat(55) })
	).toThrow('address');
	expect(() =>
		createAtlasDirectoryEntry({ ...atlasDraft, revision: 0 })
	).toThrow('revision');
});
