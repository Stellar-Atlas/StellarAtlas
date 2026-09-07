import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { findKnownArchiveCopyCoverage } from '../KnownArchiveCopyCoverageQuery.js';
import {
	createEvidenceEvent,
	createEvidenceObject,
	createKnownEvidenceDataSource,
	evidenceBucketHash,
	evidenceBucketKey,
	evidenceRootA,
	evidenceRootB,
	resetKnownEvidence,
	saveEvidenceNetworkStates,
	setEvidenceBucketProof,
	setEvidenceContentProof,
	setEvidenceEventTime,
	setEvidenceObjectTime
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);

const createdAt = '2026-07-10T00:00:00.000Z';
const verifiedAt = '2026-07-10T01:00:00.000Z';
const snapshotAt = new Date('2026-07-10T02:00:00.000Z');
const failedAt = '2026-07-10T03:00:00.000Z';
const digest = 'a'.repeat(64);

describe('narrow archive copy proof descriptors', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = await createKnownEvidenceDataSource(postgres.url);
	});
	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});
	beforeEach(async () => resetKnownEvidence(dataSource));

	async function saveObjects(objects: readonly HistoryArchiveObject[]) {
		await dataSource.getRepository(HistoryArchiveObject).save([...objects]);
		await saveEvidenceNetworkStates(
			dataSource,
			objects.map((object) => [object.archiveUrlIdentity, 'pubnet'] as const)
		);
		for (const object of objects)
			await setEvidenceObjectTime(dataSource, object, createdAt);
	}

	async function saveEvent(
		object: HistoryArchiveObject,
		type: HistoryArchiveObjectEvent['eventType'],
		at = verifiedAt
	) {
		const event = createEvidenceEvent(object, type, null);
		await dataSource.getRepository(HistoryArchiveObjectEvent).save(event);
		await setEvidenceEventTime(dataSource, event, at);
		return event;
	}

	async function coverage(source: HistoryArchiveObject, at = snapshotAt) {
		const result = await findKnownArchiveCopyCoverage(
			dataSource.manager,
			[source],
			[],
			1,
			at
		);
		return result[0]?.network;
	}

	it('keeps exact counts with large unrelated facts and excludes other networks, digests and representations', async () => {
		const source = createEvidenceObject(
			evidenceRootA,
			'ledger:63',
			'ledger',
			'failed'
		);
		setEvidenceContentProof(source, digest.toUpperCase());
		const copies = Array.from({ length: 6 }, (_, index) => {
			const copy = createEvidenceObject(
				`https://copy-${index}.example.com`,
				'ledger:63',
				'ledger',
				'verified'
			);
			setEvidenceContentProof(copy, index === 3 ? 'b'.repeat(64) : digest);
			return copy;
		});
		await saveObjects([source, ...copies]);
		await dataSource.query(
			'update history_archive_state_snapshot set "networkPassphrase" = $1 where "archiveUrlIdentity" = $2',
			['testnet', copies[5]!.archiveUrlIdentity]
		);
		const irrelevant = randomBytes(262_144).toString('base64');
		for (const object of [source, ...copies]) {
			const event = await saveEvent(object, 'verified');
			const facts = {
				...object.verificationFacts,
				observations: { irrelevant },
				...(object === copies[4]
					? {
							content: {
								algorithm: 'sha256',
								digest,
								representation: 'compressed-xdr'
							}
						}
					: {})
			};
			await dataSource.query(
				'update history_archive_object_queue set "verificationFacts" = $1 where "remoteId" = $2',
				[facts, object.remoteId]
			);
			await dataSource.query(
				'update history_archive_object_event set "verificationFacts" = $1 where "remoteId" = $2',
				[facts, event.remoteId]
			);
		}
		const result = await coverage(source);
		expect(result?.count).toBe(3);
		expect(result?.copies).toHaveLength(1);
		expect(result?.copies[0]?.archiveUrlIdentity).toBe(
			copies[0]!.archiveUrlIdentity
		);
	});

	it('uses the source verified event and the latest copy event as of the snapshot, not current failed facts', async () => {
		const source = createEvidenceObject(
			evidenceRootA,
			'ledger:63',
			'ledger',
			'failed'
		);
		const copy = createEvidenceObject(
			evidenceRootB,
			'ledger:63',
			'ledger',
			'verified'
		);
		for (const object of [source, copy])
			setEvidenceContentProof(object, digest);
		await saveObjects([source, copy]);
		await saveEvent(source, 'verified');
		await saveEvent(copy, 'verified');
		for (const object of [source, copy]) {
			setEvidenceContentProof(object, 'b'.repeat(64));
			await dataSource.query(
				'update history_archive_object_queue set status = $1, "updatedAt" = $2, "verificationFacts" = $3 where "remoteId" = $4',
				['failed', failedAt, object.verificationFacts, object.remoteId]
			);
			await saveEvent(object, 'failed', failedAt);
		}
		expect(await coverage(source)).toMatchObject({
			count: 1,
			copies: [{ remoteId: copy.remoteId, verifiedAt: new Date(verifiedAt) }]
		});
		expect(
			await coverage(source, new Date('2026-07-10T04:00:00.000Z'))
		).toEqual({ count: 0, copies: [] });
	});

	it.each([
		['SQL null', null, 1],
		['JSON null', 'null', 0],
		['empty object', '{}', 0],
		['scalar document', '42', 0],
		['array document', '[]', 0],
		['scalar content', '{"content":42}', 0],
		['array content', '{"content":[]}', 0]
	])(
		'preserves whole-document fallback for %s event facts',
		async (_label, facts, expected) => {
			const source = createEvidenceObject(
				evidenceRootA,
				'ledger:63',
				'ledger',
				'failed'
			);
			const copy = createEvidenceObject(
				evidenceRootB,
				'ledger:63',
				'ledger',
				'verified'
			);
			for (const object of [source, copy])
				setEvidenceContentProof(object, digest);
			await saveObjects([source, copy]);
			const event = await saveEvent(copy, 'verified');
			await dataSource.query(
				'update history_archive_object_event set "verificationFacts" = $1::jsonb where "remoteId" = $2',
				[facts, event.remoteId]
			);
			expect((await coverage(source))?.count).toBe(expected);
		}
	);

	it('does not fall back to current source content when a verified event has no content descriptor', async () => {
		const source = createEvidenceObject(
			evidenceRootA,
			'ledger:63',
			'ledger',
			'failed'
		);
		const copy = createEvidenceObject(
			evidenceRootB,
			'ledger:63',
			'ledger',
			'verified'
		);
		setEvidenceContentProof(source, digest);
		setEvidenceContentProof(copy, 'b'.repeat(64));
		await saveObjects([source, copy]);
		const event = await saveEvent(source, 'verified');
		await dataSource.query(
			'update history_archive_object_event set "verificationFacts" = $1::jsonb where "remoteId" = $2',
			['{}', event.remoteId]
		);
		// Existing checkpoint-identity fallback applies only without a source digest.
		expect((await coverage(source))?.count).toBe(1);
	});

	it('requires both the bucket hash and a matched expected-hash receipt', async () => {
		const source = createEvidenceObject(
			evidenceRootA,
			evidenceBucketKey,
			'bucket',
			'failed'
		);
		const copy = createEvidenceObject(
			evidenceRootB,
			evidenceBucketKey,
			'bucket',
			'verified'
		);
		setEvidenceBucketProof(copy);
		await saveObjects([source, copy]);
		expect((await coverage(source))?.count).toBe(1);
		for (const bucketObject of [
			{ matched: false, expectedBucketHash: evidenceBucketHash },
			{ matched: true, expectedBucketHash: 'b'.repeat(64) }
		]) {
			await dataSource.query(
				'update history_archive_object_queue set "verificationFacts" = $1 where "remoteId" = $2',
				[{ bucketObject }, copy.remoteId]
			);
			expect((await coverage(source))?.count).toBe(0);
		}
	});

	it('requires a current-only verification to predate the requested snapshot', async () => {
		const source = createEvidenceObject(
			evidenceRootA,
			'ledger:63',
			'ledger',
			'failed'
		);
		const copy = createEvidenceObject(
			evidenceRootB,
			'ledger:63',
			'ledger',
			'verified'
		);
		for (const object of [source, copy])
			setEvidenceContentProof(object, digest);
		await saveObjects([source, copy]);
		await dataSource.query(
			'update history_archive_object_queue set "updatedAt" = $1 where "remoteId" = $2',
			[failedAt, copy.remoteId]
		);
		expect((await coverage(source))?.count).toBe(0);
		expect(
			(await coverage(source, new Date('2026-07-10T04:00:00.000Z')))?.count
		).toBe(1);
	});
});
