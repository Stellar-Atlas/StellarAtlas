import type { EntityManager } from 'typeorm';
import {
	findVerifiedCheckpointObjectSources,
	historyArchiveVerifiedCheckpointSourceSql
} from '../HistoryArchiveVerifiedCheckpointSourceQuery.js';

const targetRemoteId = '11111111-1111-4111-8111-111111111111';
const candidateRemoteId = '22222222-2222-4222-8222-222222222222';
const publicResolver = async (): Promise<readonly string[]> => ['8.8.8.8'];

describe('HistoryArchiveVerifiedCheckpointSourceQuery', () => {
	it('maps bounded sources backed by current strict checkpoint proof', async () => {
		const query = jest.fn(async (): Promise<unknown[]> => [candidateRow()]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			findVerifiedCheckpointObjectSources(
				manager,
				[targetRemoteId, targetRemoteId],
				99,
				publicResolver
			)
		).resolves.toEqual([
			{
				anchorKind: 'target-digest',
				archiveUrl: 'https://copy.example.com',
				archiveUrlIdentity: 'https://copy.example.com',
				candidateRemoteId,
				checkpointLedger: 63355999,
				contentDigest: 'a'.repeat(64),
				contentRepresentation: 'uncompressed-xdr',
				corroboratingSourceCount: 1,
				objectUrl:
					'https://copy.example.com/transactions/03/c1/dc/transactions-03c1dcbf.xdr.gz',
				proofEvaluatedAt: new Date('2026-07-16T00:01:00.000Z'),
				proofId: 42,
				proofVersion: 7,
				targetRemoteId,
				verifiedAt: new Date('2026-07-16T00:00:00.000Z')
			}
		]);
		expect(query).toHaveBeenCalledWith(
			historyArchiveVerifiedCheckpointSourceSql,
			[[targetRemoteId], 5]
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'copy."objectKey" = source."sourceObjectKey"'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'proof."checkpointStateObjectRemoteId" = candidate."remoteId"'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'proof."transactionsObjectRemoteId" = candidate."remoteId"'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'proof."proofVersion" ='
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'proof."evaluatedAt" >= candidate."verifiedAt"'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'consensus.source_count >= 2'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'count(distinct candidate."hostIdentity")'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'qualifying.qualifying_group_count = 1'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'candidate_state."networkPassphrase" ='
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'proof."scpObjectRemoteId" = candidate."remoteId"'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'proof_input."updatedAt" <= proof."evaluatedAt"'
		);
		expect(historyArchiveVerifiedCheckpointSourceSql).toContain(
			'where candidate_rank <= $2::integer'
		);
	});

	it('does not query PostgreSQL without requested failures', async () => {
		const query = jest.fn(async (): Promise<unknown[]> => []);
		const manager = { query } as unknown as EntityManager;

		await expect(
			findVerifiedCheckpointObjectSources(manager, [], 5)
		).resolves.toEqual([]);
		expect(query).not.toHaveBeenCalled();
	});

	it.each([
		'file:///srv/private/archive.json',
		'https://127.0.0.1/transactions/file.xdr.gz',
		'https://copy.example.com/transactions/file.xdr.gz?token=secret',
		'https://other.example.com/transactions/file.xdr.gz'
	])('rejects unsafe replacement URL %s', async (objectUrl) => {
		const manager = {
			query: jest.fn(async (): Promise<unknown[]> => [
				{ ...candidateRow(), objectUrl }
			])
		} as unknown as EntityManager;

		await expect(
			findVerifiedCheckpointObjectSources(
				manager,
				[targetRemoteId],
				5,
				publicResolver
			)
		).resolves.toEqual([]);
	});

	it('omits candidates whose hostname resolves to a private address', async () => {
		const manager = {
			query: jest.fn(async (): Promise<unknown[]> => [candidateRow()])
		} as unknown as EntityManager;

		await expect(
			findVerifiedCheckpointObjectSources(
				manager,
				[targetRemoteId],
				5,
				async () => ['192.168.1.20']
			)
		).resolves.toEqual([]);
	});
});

function candidateRow(): Record<string, unknown> {
	return {
		anchorKind: 'target-digest',
		archiveUrl: 'https://copy.example.com',
		archiveUrlIdentity: 'https://copy.example.com',
		candidateRemoteId,
		checkpointLedger: '63355999',
		contentDigest: 'A'.repeat(64),
		contentRepresentation: 'uncompressed-xdr',
		corroboratingSourceCount: 1,
		objectUrl:
			'https://copy.example.com/transactions/03/c1/dc/transactions-03c1dcbf.xdr.gz',
		proofEvaluatedAt: '2026-07-16T00:01:00.000Z',
		proofId: 42,
		proofVersion: 7,
		targetRemoteId,
		verifiedAt: '2026-07-16T00:00:00.000Z'
	};
}
