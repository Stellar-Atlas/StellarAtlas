import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	createObjectRepositoryDataSource,
	rootObject,
	saveHistoryArchiveObjects
} from './HistoryArchiveObjectRepositoryFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('archive transition proof priority', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createObjectRepositoryDataSource(
			postgres.url
		));
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('reconciles canonical proof effects before older generic effects', async () => {
		const generic = verifiedTransition(
			'https://generic.example/archive',
			'planned-frontier',
			new Date('2026-01-01T00:00:00.000Z')
		);
		const canonical = verifiedTransition(
			'https://canonical.example/archive',
			'canonical-frontier-reserve',
			new Date('2026-01-02T00:00:00.000Z')
		);
		await saveHistoryArchiveObjects(dataSource, generic, canonical);

		const transitions = await repository.findUnreconciledTransitions(1);

		expect(transitions.map((object) => object.remoteId)).toEqual([
			canonical.remoteId
		]);
	});
});

function verifiedTransition(
	archiveUrl: string,
	executionReason: string,
	requiredAt: Date
): HistoryArchiveObject {
	const object = rootObject(archiveUrl, 'verified');
	object.executionReason = executionReason;
	object.transitionEffectsRequiredAt = requiredAt;
	object.transitionEffectsCompletedAt = null;
	return object;
}
