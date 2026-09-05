/// <reference types="jest" />

import {
	getArchiveRepairDownloadPath,
	isValidArchiveRepairArtifactPath
} from '../archive-repair-download-path';

const targetId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const digest = 'a'.repeat(64);

describe('archive repair download path', () => {
	it('maps exact backend artifact paths to the same-origin proxy', () => {
		expect(
			getArchiveRepairDownloadPath(
				`/v1/archive-scans/repair-artifacts/buckets/${digest}`
			)
		).toBe(`/api/archive-repair-artifacts/buckets/${digest}`);
		const objectPath =
			'/v1/archive-scans/repair-artifacts/objects/' +
			`${targetId}/1780000000000/missing/${candidateId}/41/10/1780000000001/${digest}`;
		expect(getArchiveRepairDownloadPath(objectPath)).toBe(
			objectPath.replace(
				'/v1/archive-scans/repair-artifacts/',
				'/api/archive-repair-artifacts/'
			)
		);
	});

	it.each([
		'https://attacker.example/v1/archive-scans/repair-artifacts/buckets/' +
			digest,
		'/v1/archive-scans/repair-artifacts/buckets/' + digest + '?download=1',
		'/v1/archive-scans/repair-artifacts/buckets/../secret',
		'/v1/archive-scans/repair-artifacts/objects/' + targetId
	])('rejects an invalid or attacker-controlled URL: %s', (value) => {
		expect(getArchiveRepairDownloadPath(value)).toBeNull();
	});

	it('validates the complete proof-bound object identity', () => {
		expect(
			isValidArchiveRepairArtifactPath([
				'objects',
				targetId,
				'1780000000000',
				'integrity',
				candidateId,
				'41',
				'10',
				'1780000000001',
				digest
			])
		).toBe(true);
	});
});
