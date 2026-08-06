import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { RequestHistoryArchiveObjectRecheck } from '../RequestHistoryArchiveObjectRecheck.js';

describe('RequestHistoryArchiveObjectRecheck', () => {
	it('maps the repository decision to the public timestamp contract', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		const remoteId = '11111111-1111-4111-8111-111111111111';
		repository.requestObjectRecheck.mockResolvedValue({
			blockedUntil: new Date('2026-08-05T12:05:00.000Z'),
			eligibleAt: new Date('2026-08-05T12:00:00.000Z'),
			reason: 'host-backoff',
			remoteId,
			state: 'blocked'
		});
		const useCase = new RequestHistoryArchiveObjectRecheck(
			repository,
			mock<ExceptionLogger>()
		);

		const result = await useCase.execute(remoteId);

		expect(result._unsafeUnwrap()).toEqual({
			eligibleAt: '2026-08-05T12:00:00.000Z',
			hostBackoffUntil: '2026-08-05T12:05:00.000Z',
			reason: 'host-backoff',
			remoteId,
			state: 'blocked'
		});
	});

	it('preserves not-found as a successful null result', async () => {
		const repository = mock<HistoryArchiveObjectRepository>();
		repository.requestObjectRecheck.mockResolvedValue(null);
		const useCase = new RequestHistoryArchiveObjectRecheck(
			repository,
			mock<ExceptionLogger>()
		);

		const result = await useCase.execute(
			'22222222-2222-4222-8222-222222222222'
		);

		expect(result._unsafeUnwrap()).toBeNull();
	});
});
