import { mock } from 'jest-mock-extended';
import type { HistoryArchiveRepairArtifactRepository } from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { ResolveHistoryArchiveRepairArtifacts } from '../ResolveHistoryArchiveRepairArtifacts.js';

describe('ResolveHistoryArchiveRepairArtifacts', () => {
	it('uses proof time with cheap local presence and deduplicates hashes', async () => {
		const repository = mock<HistoryArchiveRepairArtifactRepository>();
		const bucketHash = 'a'.repeat(64);
		repository.inspectBucketPresence.mockResolvedValue({
			bucketHash,
			byteLength: 42,
			status: 'present'
		});
		const resolver = new ResolveHistoryArchiveRepairArtifacts(repository);

		const result = await resolver.execute([
			{ bucketHash, provenAt: new Date('2026-07-16T00:00:00.000Z') },
			{ bucketHash, provenAt: new Date('2026-07-16T00:01:00.000Z') }
		]);

		expect(repository.inspectBucketPresence).toHaveBeenCalledTimes(1);
		expect(result.get(bucketHash)).toEqual(
			expect.objectContaining({
				byteLength: 42,
				provenAt: '2026-07-16T00:01:00.000Z',
				status: 'verify-on-download'
			})
		);
	});

	it('bounds filesystem probes and defers the remainder', async () => {
		const repository = mock<HistoryArchiveRepairArtifactRepository>();
		repository.inspectBucketPresence.mockImplementation(async (bucketHash) => ({
			bucketHash,
			byteLength: 42,
			status: 'present'
		}));
		const resolver = new ResolveHistoryArchiveRepairArtifacts(repository);
		const candidates = Array.from({ length: 101 }, (_, index) => ({
			bucketHash: index.toString(16).padStart(64, '0'),
			provenAt: new Date('2026-07-16T00:00:00.000Z')
		}));

		const result = await resolver.execute(candidates);

		expect(repository.inspectBucketPresence).toHaveBeenCalledTimes(100);
		expect(result.get(candidates[100]?.bucketHash ?? '')).toMatchObject({
			reason: 'verification-deferred',
			status: 'unavailable'
		});
	});
});
