import { mock } from 'jest-mock-extended';
import type { ScpStatementLiveStore } from '@network-scan/domain/scp/ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from '@network-scan/domain/scp/ScpStatementObservationRepository.js';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import { GetScpStatements } from '../GetScpStatements.js';

describe('GetScpStatements', () => {
	afterEach(() => jest.useRealTimers());

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
			after: undefined,
			limit: 100,
			nodeId: undefined,
			order: 'desc',
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
			after: undefined,
			limit: 100,
			nodeId: undefined,
			order: 'desc',
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

	it('labels a fresh canonical fallback when Meilisearch is unavailable', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:05.000Z'));
		const sut = setupSUT();
		const observation = createObservation();
		sut.liveStore.findLatest.mockResolvedValue(null);
		sut.repository.findLatest.mockResolvedValue([observation]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toEqual({
			freshness: 'fresh',
			freshnessMs: 5_000,
			observations: [observation.toDTO()],
			observedAt: '2026-07-05T00:00:00.000Z',
			source: 'postgres_canonical'
		});
	});

	it('prefers fresher canonical evidence over an available stale Meili page', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:40.000Z'));
		const sut = setupSUT();
		const canonical = createObservation();
		canonical.observedAt = new Date('2026-07-05T00:00:39.000Z');
		canonical.statementHash = 'canonical-newer';
		sut.liveStore.findLatest.mockResolvedValue([createObservation().toDTO()]);
		sut.repository.findLatest.mockResolvedValue([canonical]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			freshness: 'fresh',
			freshnessMs: 1_000,
			observations: [canonical.toDTO()],
			source: 'postgres_canonical'
		});
	});

	it('does not let a stale future-dated Meili cursor beat fresh canonical evidence', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:06.000Z'));
		const sut = setupSUT();
		const canonical = createObservation();
		canonical.observedAt = new Date('2026-07-05T00:00:05.000Z');
		canonical.statementHash = 'canonical-fresh';
		const futureDatedLive = createObservation().toDTO();
		futureDatedLive.observedAt = '2026-07-05T00:00:20.000Z';
		futureDatedLive.statementHash = 'meili-newer-but-stale';
		sut.liveStore.findLatest.mockResolvedValue([futureDatedLive]);
		sut.repository.findLatest.mockResolvedValue([canonical]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			freshness: 'fresh',
			freshnessMs: 1_000,
			observations: [canonical.toDTO()],
			source: 'postgres_canonical'
		});
	});

	it('uses canonical evidence when a fresher Meili page has a newer disagreeing cursor', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:06.000Z'));
		const sut = setupSUT();
		const canonical = createObservation();
		canonical.observedAt = new Date('2026-07-05T00:00:05.000Z');
		canonical.statementHash = 'canonical-statement';
		const live = createObservation().toDTO();
		live.observedAt = '2026-07-05T00:00:06.000Z';
		live.statementHash = 'meili-newer-cursor';
		sut.liveStore.findLatest.mockResolvedValue([live]);
		sut.repository.findLatest.mockResolvedValue([canonical]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			observations: [canonical.toDTO()],
			source: 'postgres_canonical'
		});
	});

	it('uses synchronized fresh Meili results when canonical has the same cursor and page', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:05.000Z'));
		const sut = setupSUT();
		const observation = createObservation();
		sut.liveStore.findLatest.mockResolvedValue([observation.toDTO()]);
		sut.repository.findLatest.mockResolvedValue([observation]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toEqual({
			freshness: 'fresh',
			freshnessMs: 5_000,
			observations: [observation.toDTO()],
			observedAt: '2026-07-05T00:00:00.000Z',
			source: 'meilisearch'
		});
		expect(sut.repository.findLatest).toHaveBeenCalledTimes(1);
	});

	it('keeps canonical evidence when equivalent Meili rows are stale', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:01:00.000Z'));
		const sut = setupSUT();
		const observation = createObservation();
		sut.liveStore.findLatest.mockResolvedValue([observation.toDTO()]);
		sut.repository.findLatest.mockResolvedValue([observation]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			freshness: 'stale',
			observations: [observation.toDTO()],
			source: 'postgres_canonical'
		});
	});

	it('uses canonical evidence when equal newest cursors hide a page disagreement', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:05.000Z'));
		const sut = setupSUT();
		const newest = createObservation();
		newest.statementHash = 'statement-newest';
		const missingFromMeili = createObservation();
		missingFromMeili.observedAt = new Date('2026-07-04T23:59:59.000Z');
		missingFromMeili.statementHash = 'statement-missing';
		sut.liveStore.findLatest.mockResolvedValue([newest.toDTO()]);
		sut.repository.findLatest.mockResolvedValue([missingFromMeili, newest]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			observations: [missingFromMeili.toDTO(), newest.toDTO()],
			source: 'postgres_canonical'
		});
	});

	it('does not let an empty Meili page hide stale canonical rows after a cursor', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:40.000Z'));
		const sut = setupSUT();
		const canonical = createObservation();
		sut.liveStore.findLatest.mockResolvedValue([]);
		sut.repository.findLatest.mockResolvedValue([canonical]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			freshness: 'stale',
			observations: [canonical.toDTO()],
			source: 'postgres_canonical'
		});
	});

	it('allows stale Meili evidence only when canonical PostgreSQL is unavailable', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:01:00.000Z'));
		const sut = setupSUT();
		const live = createObservation().toDTO();
		sut.liveStore.findLatest.mockResolvedValue([live]);
		sut.repository.findLatest.mockRejectedValue(new Error('database offline'));

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toEqual({
			freshness: 'stale',
			freshnessMs: 60_000,
			observations: [live],
			observedAt: '2026-07-05T00:00:00.000Z',
			source: 'meilisearch'
		});
	});

	it('labels both unavailable auto sources without inventing an empty page', async () => {
		const sut = setupSUT();
		sut.liveStore.findLatest.mockResolvedValue(null);
		sut.repository.findLatest.mockRejectedValue(new Error('database offline'));

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'auto'
		});

		expect(result._unsafeUnwrap()).toEqual({
			freshness: 'unavailable',
			freshnessMs: null,
			observations: [],
			observedAt: null,
			source: 'postgres_canonical'
		});
	});

	it('reports future timestamps outside tolerance as stale with nonzero age', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-05T00:00:06.000Z'));
		const sut = setupSUT();
		const live = createObservation().toDTO();
		live.observedAt = '2026-07-05T00:00:20.000Z';
		sut.liveStore.findLatest.mockResolvedValue([live]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'live'
		});

		expect(result._unsafeUnwrap()).toMatchObject({
			freshness: 'stale',
			freshnessMs: 14_000,
			observations: [live]
		});
	});

	it('does not describe a nonempty invalid-timestamp page as empty', async () => {
		const sut = setupSUT();
		const live = createObservation().toDTO();
		live.observedAt = 'not-a-timestamp';
		sut.liveStore.findLatest.mockResolvedValue([live]);

		const result = await sut.getScpStatements.executeWithMetadata({
			limit: 100,
			source: 'live'
		});

		expect(result._unsafeUnwrap()).toEqual({
			freshness: 'stale',
			freshnessMs: null,
			observations: [live],
			observedAt: null,
			source: 'meilisearch'
		});
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
