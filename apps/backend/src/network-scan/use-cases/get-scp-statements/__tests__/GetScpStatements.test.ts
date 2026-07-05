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

	it('does not fall back to stored observations by default when live is unavailable', async () => {
		const sut = setupSUT();
		sut.liveStore.findLatest.mockResolvedValue(null);

		const result = await sut.getScpStatements.execute({ limit: 100 });

		expect(result._unsafeUnwrap()).toEqual([]);
		expect(sut.repository.findLatest).not.toHaveBeenCalled();
	});

	it('falls back to stored observations when auto source is requested', async () => {
		const sut = setupSUT();
		const observation = createObservation();
		sut.liveStore.findLatest.mockResolvedValue(null);
		sut.repository.findLatest.mockResolvedValue([observation]);

		const result = await sut.getScpStatements.execute({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toEqual([observation.toDTO()]);
		expect(sut.repository.findLatest).toHaveBeenCalledWith({
			limit: 100,
			nodeId: undefined,
			slotIndex: undefined
		});
	});

	it('reads stored observations directly when stored source is requested', async () => {
		const sut = setupSUT();
		const observation = createObservation();
		sut.repository.findLatest.mockResolvedValue([observation]);

		const result = await sut.getScpStatements.execute({
			limit: 100,
			source: 'stored'
		});

		expect(result._unsafeUnwrap()).toEqual([observation.toDTO()]);
		expect(sut.liveStore.findLatest).not.toHaveBeenCalled();
		expect(sut.repository.findLatest).toHaveBeenCalledWith({
			limit: 100,
			nodeId: undefined,
			slotIndex: undefined
		});
	});

	it('passes cursor and ascending order to the live read model', async () => {
		const sut = setupSUT();
		const liveObservation = createObservation().toDTO();
		sut.liveStore.findLatest.mockResolvedValue([liveObservation]);

		const result = await sut.getScpStatements.execute({
			after: {
				observedAtMs: 1_783_398_400_000,
				statementHash: 'statement-a'
			},
			limit: 50,
			order: 'asc',
			source: 'live'
		});

		expect(result._unsafeUnwrap()).toEqual([liveObservation]);
		expect(sut.liveStore.findLatest).toHaveBeenCalledWith({
			after: {
				observedAtMs: 1_783_398_400_000,
				statementHash: 'statement-a'
			},
			limit: 50,
			nodeId: undefined,
			order: 'asc',
			slotIndex: undefined
		});
		expect(sut.repository.findLatest).not.toHaveBeenCalled();
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
	observation.nodeId =
		'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
	observation.observedAt = new Date('2026-07-05T00:00:00.000Z');
	observation.observedFromAddress = '127.0.0.1:11625';
	observation.observedFromPeer =
		'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
	observation.slotIndex = '63326550';
	observation.statementHash = 'statement-hash';
	observation.statementType = 'externalize';
	return observation;
}
