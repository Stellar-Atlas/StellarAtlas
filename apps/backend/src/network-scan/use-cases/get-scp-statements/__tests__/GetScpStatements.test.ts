import { mock } from 'jest-mock-extended';
import type { ScpStatementLiveStore } from '@network-scan/domain/scp/ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from '@network-scan/domain/scp/ScpStatementObservationRepository.js';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import { GetScpStatements } from '../GetScpStatements.js';

describe('GetScpStatements', () => {
	it('returns empty live results without falling back to stale stored observations', async () => {
		const sut = setupSUT();
		sut.liveStore.findLatest.mockResolvedValue([]);

		const result = await sut.getScpStatements.execute({ limit: 100 });

		expect(result._unsafeUnwrap()).toEqual([]);
		expect(sut.repository.findLatest).not.toHaveBeenCalled();
	});

	it('falls back to stored observations when the live store is unavailable', async () => {
		const sut = setupSUT();
		const observation = createObservation();
		sut.liveStore.findLatest.mockResolvedValue(null);
		sut.repository.findLatest.mockResolvedValue([observation]);

		const result = await sut.getScpStatements.execute({ limit: 100 });

		expect(result._unsafeUnwrap()).toEqual([observation.toDTO()]);
		expect(sut.repository.findLatest).toHaveBeenCalledWith({ limit: 100 });
	});
});

function setupSUT() {
	const repository = mock<ScpStatementObservationRepository>();
	const liveStore = mock<ScpStatementLiveStore>();
	return {
		getScpStatements: new GetScpStatements(repository, liveStore),
		liveStore,
		repository
	};
}

function createObservation(): ScpStatementObservation {
	const observation = new ScpStatementObservation();
	observation.nodeId = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
	observation.observedAt = new Date('2026-07-05T00:00:00.000Z');
	observation.observedFromAddress = '127.0.0.1:11625';
	observation.observedFromPeer =
		'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
	observation.slotIndex = '63326550';
	observation.statementHash = 'statement-hash';
	observation.statementType = 'externalize';
	return observation;
}
