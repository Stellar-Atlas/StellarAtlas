import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { toObjectRepairAction } from '../HistoryArchiveRepairActionMapper.js';

describe('HistoryArchiveRepairActionMapper', () => {
	it('keeps a missing root state actionable while awaiting a proven source', () => {
		const object = new HistoryArchiveObject({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			objectKey: 'root',
			objectOrder: 1,
			objectType: 'history-archive-state',
			objectUrl:
				'https://history.example.com/.well-known/stellar-history.json',
			remoteId: crypto.randomUUID(),
			status: 'failed'
		});
		object.errorType = 'archive_http_error';
		object.errorMessage = 'Remote history archive state was not found';
		object.httpStatus = 404;
		object.nextAttemptAt = new Date('2026-07-07T18:05:00.000Z');
		(object as HistoryArchiveObject & { updatedAt: Date }).updatedAt = new Date(
			'2026-07-07T18:00:00.000Z'
		);

		const actions = toObjectRepairAction(object, [], new Map());

		expect(actions).toEqual([
			expect.objectContaining({
				evidence: [
					expect.objectContaining({
						nextAttemptAt: '2026-07-07T18:05:00.000Z'
					})
				],
				kind: 'restore-history-archive-state',
				knownGoodSources: [],
				reason: 'history-archive-state-missing',
				repairArtifact: null,
				severity: 'blocked',
				summary:
					'History archive state file evidence is confirmed, but no proven-good replacement source is available yet.'
			})
		]);
	});
});
