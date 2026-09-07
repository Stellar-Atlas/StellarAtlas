import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { HistoryArchiveListingGapDTO } from 'history-scanner-dto';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveRemoteFailureContinuationMigration1788601000000 } from '../../../database/migrations/1788601000000-HistoryArchiveRemoteFailureContinuationMigration.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createRoot,
	createCheckpoint,
	createBucketMissingProof
} from './HistoryArchiveObjectExecutionTestFixtures.js';
import { markHistoryArchiveObjectFailed } from '../HistoryArchiveObjectFailureWrite.js';
import { persistHistoryArchiveListingGap } from '../HistoryArchiveListingGapWrite.js';
import {
	materializeNextCompactCheckpointPlans,
	materializeCompactCheckpointPlans
} from '../HistoryArchiveCompactPlanning.js';
import { historyArchiveListingGapAnchorSql } from '../HistoryArchiveListingGapSql.js';

jest.setTimeout(60_000);
const targetUrl = 'http://stellar-history.ylds.com/validator-us-west1-0';
const lastMissing = 64_205_887;
const resume = lastMissing + 64;

function evidence(): HistoryArchiveListingGapDTO {
	return {
		kind: 'gcs-listing-gap',
		archiveRoot: targetUrl,
		missingFromCheckpoint: 127,
		missingThroughCheckpoint: lastMissing,
		observedAt: new Date().toISOString(),
		listings: (['history', 'ledger', 'transactions', 'results'] as const).map(
			(category) => {
				const prefix = 'validator-us-west1-0/' + category + '/';
				const key = (checkpoint: number) => {
					const hex = checkpoint.toString(16).padStart(8, '0');
					return (
						prefix +
						hex.slice(0, 2) +
						'/' +
						hex.slice(2, 4) +
						'/' +
						hex.slice(4, 6) +
						'/' +
						category +
						'-' +
						hex +
						(category === 'history' ? '.json' : '.xdr.gz')
					);
				};
				const url = new URL(
					'https://storage.googleapis.com/stellar-history.ylds.com'
				);
				url.searchParams.set('prefix', prefix);
				url.searchParams.set('marker', key(63));
				url.searchParams.set('max-keys', '2');
				return {
					category,
					listingUrl: url.href,
					responseSha256: 'ab'.repeat(32),
					firstReturnedKey: key(resume),
					firstReturnedCheckpoint: resume
				};
			}
		)
	};
}

describe('compact listing evidence and source-boundary continuation', () => {
	let db: DataSource;
	let pg: DisposablePostgres;
	let failed: HistoryArchiveObject;
	let sourceProof: HistoryArchiveCheckpointProof;
	const oldCanonical = process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;

	beforeAll(async () => {
		pg = await startDisposablePostgres();
		db = new DataSource({
			type: 'postgres',
			url: pg.url,
			synchronize: true,
			entities: [HistoryArchiveObject, HistoryArchiveCheckpointProof]
		});
		await db.initialize();
		await createCanonicalFrontierTestSchema(db);
		const runner = db.createQueryRunner();
		try {
			await new HistoryArchiveRemoteFailureContinuationMigration1788601000000().up(
				runner
			);
		} finally {
			await runner.release();
		}
		await db.query(
			'create table history_archive_object_claim_slot ("objectRemoteId" uuid, "claimAttempt" integer, "claimedAt" timestamptz, "updatedAt" timestamptz)'
		);
	});
	afterAll(async () => {
		if (oldCanonical === undefined)
			delete process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
		else process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = oldCanonical;
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = '';
		await db.query(
			'truncate history_archive_object_queue, history_archive_checkpoint_proof, history_archive_state_snapshot, history_archive_checkpoint_scan_cursor, history_archive_checkpoint_substitution cascade'
		);
		const target = createRoot(40),
			source = createRoot(41);
		target.archiveUrl = targetUrl;
		target.archiveUrlIdentity = targetUrl;
		await db.getRepository(HistoryArchiveObject).save([target, source]);
		await db.query(
			"insert into history_archive_state_snapshot (\"archiveUrlIdentity\",status,\"currentLedger\",\"networkPassphrase\") values ($1,'available',$3,'network'),($2,'available',$3,'network')",
			[targetUrl, source.archiveUrlIdentity, resume]
		);
		await db.query(
			'insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger") values ($1,$2,191)',
			[targetUrl, resume]
		);
		failed = createCheckpoint(40, 127);
		failed.archiveUrl = targetUrl;
		failed.archiveUrlIdentity = targetUrl;
		failed.status = 'scanning';
		failed.attempts = 1;
		await db.getRepository(HistoryArchiveObject).save(failed);
		const failureProof = createBucketMissingProof(targetUrl, 127);
		failureProof.failureKind = 'object-failed';
		failureProof.requiredObjectsComplete = false;
		const prior = createBucketMissingProof(source.archiveUrlIdentity, 127);
		prior.status = 'verified';
		prior.failureKind = null;
		prior.bucketsVerified = true;
		sourceProof = createBucketMissingProof(
			source.archiveUrlIdentity,
			lastMissing
		);
		sourceProof.status = 'verified';
		sourceProof.failureKind = null;
		sourceProof.bucketsVerified = true;
		await db
			.getRepository(HistoryArchiveCheckpointProof)
			.save([failureProof, prior, sourceProof]);
	});

	async function fail(claimAttempt = 1, gap = evidence()) {
		return markHistoryArchiveObjectFailed(
			db.getRepository(HistoryArchiveObject),
			failed.remoteId,
			{
				claimAttempt,
				errorType: 'archive_http_error',
				errorMessage: 'HTTP 404',
				failureChannel: 'archive_availability',
				httpStatus: 404,
				listingGap: gap,
				nextAttemptAt: null
			}
		);
	}

	it('rejects a stale claim without writing range evidence', async () => {
		expect(await fail(2)).toBe(false);
		expect(await db.query('select * from history_archive_listing_gap')).toEqual(
			[]
		);
	});

	for (const mode of ['completion', 'recovery'] as const) {
		it(
			mode +
				': skips a million absent positions without manufacturing proof or object rows',
			async () => {
				expect(await fail()).toBe(true);
				const before = await db.query(
					'select count(*)::integer count from history_archive_checkpoint_proof'
				);
				const plan = () =>
					mode === 'completion'
						? materializeNextCompactCheckpointPlans(db.manager, [
								{ archiveUrlIdentity: targetUrl, checkpointLedger: 127 }
							])
						: materializeCompactCheckpointPlans(db.manager, [targetUrl]);
				await plan();
				await plan();
				const ready = await db.query(
					'select object."checkpointLedger" from history_archive_object_ready ready join history_archive_object_queue object on object."remoteId"=ready."objectRemoteId" where object."archiveUrlIdentity"=$1',
					[targetUrl]
				);
				expect(ready).toEqual([{ checkpointLedger: resume }]);
				expect(
					await db.query(
						'select count(*)::integer count from history_archive_checkpoint_proof'
					)
				).toEqual(before);
				expect(
					await db.query(
						'select "nextHistoricalCheckpointLedger" from history_archive_checkpoint_scan_cursor where "archiveUrlIdentity"=$1',
						[targetUrl]
					)
				).toEqual([{ nextHistoricalCheckpointLedger: resume + 64 }]);
				const ranges = await db.query(
					'select "sourceCheckpointProofId","firstCheckpointLedger","lastCheckpointLedger" from history_archive_listing_gap'
				);
				expect(ranges).toEqual([
					{
						sourceCheckpointProofId: String(sourceProof.id),
						firstCheckpointLedger: 127,
						lastCheckpointLedger: lastMissing
					}
				]);
				expect(
					(
						await db
							.getRepository(HistoryArchiveObject)
							.findOneByOrFail({ remoteId: failed.remoteId })
					).status
				).toBe('failed');
			}
		);
	}

	it('keeps one evidence row on repeated accepted reports', async () => {
		await fail();
		await persistHistoryArchiveListingGap(
			db.manager,
			failed.remoteId,
			evidence()
		);
		expect(
			await db.query(
				'select count(*)::integer count from history_archive_listing_gap'
			)
		).toEqual([{ count: 1 }]);
	});

	it('uses a later verified boundary for a null anchor without rewriting range evidence', async () => {
		const proofs = db.getRepository(HistoryArchiveCheckpointProof);
		await proofs.update(sourceProof.id, { status: 'pending' });
		expect(await fail()).toBe(true);
		const rangeBefore = await db.query(
			'select * from history_archive_listing_gap'
		);
		expect(rangeBefore[0].sourceCheckpointProofId).toBeNull();
		const anchorSql = historyArchiveListingGapAnchorSql('$1', '$2');
		expect(await db.query(anchorSql, [targetUrl, lastMissing])).toEqual([]);
		const ledger = createCheckpoint(41, lastMissing);
		ledger.objectType = 'ledger';
		ledger.objectKey = 'ledger:' + lastMissing.toString(16);
		ledger.status = 'verified';
		await db.getRepository(HistoryArchiveObject).save(ledger);
		await db.query(
			'update history_archive_object_queue set "verificationFacts"=$2::jsonb where "remoteId"=$1',
			[
				ledger.remoteId,
				JSON.stringify({
					ledgerCategory: {
						ledgers: [
							{ ledger: lastMissing, ledgerHeaderHash: 'ab'.repeat(32) }
						]
					}
				})
			]
		);
		await proofs.update(sourceProof.id, {
			status: 'verified',
			ledgerObjectRemoteId: ledger.remoteId
		});
		const boundary = await db.query(
			"select object.\"verificationFacts\"->'ledgerCategory'->'ledgers'->0->>'ledgerHeaderHash' as hash from (" +
				anchorSql +
				') anchor join history_archive_object_queue object on object."remoteId"=anchor."ledgerObjectRemoteId"',
			[targetUrl, lastMissing]
		);
		expect(boundary).toEqual([{ hash: 'ab'.repeat(32) }]);
		await materializeNextCompactCheckpointPlans(db.manager, [
			{ archiveUrlIdentity: targetUrl, checkpointLedger: 127 }
		]);
		expect(
			await db.query(
				'select "nextHistoricalCheckpointLedger" from history_archive_checkpoint_scan_cursor where "archiveUrlIdentity"=$1',
				[targetUrl]
			)
		).toEqual([{ nextHistoricalCheckpointLedger: resume + 64 }]);
		expect(await db.query('select * from history_archive_listing_gap')).toEqual(
			rangeBefore
		);
		expect(
			(
				await db
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: failed.remoteId })
			).status
		).toBe('failed');
	});

	it('does not replace an explicitly stored invalid anchor with a different valid source', async () => {
		await fail();
		await db
			.getRepository(HistoryArchiveCheckpointProof)
			.update(sourceProof.id, { status: 'pending' });
		const alternate = createBucketMissingProof(
			'https://another-source.example',
			lastMissing
		);
		alternate.status = 'verified';
		alternate.failureKind = null;
		await db.getRepository(HistoryArchiveCheckpointProof).save(alternate);
		await db.query(
			'insert into history_archive_state_snapshot ("archiveUrlIdentity",status,"currentLedger","networkPassphrase") values ($1,\'available\',$2,\'network\')',
			[alternate.archiveUrlIdentity, resume]
		);
		expect(
			await db.query(historyArchiveListingGapAnchorSql('$1', '$2'), [
				targetUrl,
				lastMissing
			])
		).toEqual([]);
	});

	it('does not accept another bucket or prefix as evidence for this root', async () => {
		const gap = evidence();
		await fail(1, {
			...gap,
			listings: gap.listings.map((item) => ({
				...item,
				listingUrl: item.listingUrl.replace(
					'stellar-history.ylds.com',
					'unrelated-bucket'
				)
			}))
		});
		expect(await db.query('select * from history_archive_listing_gap')).toEqual(
			[]
		);
	});

	it('accepts same-origin S3-compatible listing evidence without assuming Google', async () => {
		const gap = evidence();
		await fail(1, {
			...gap,
			kind: 's3-listing-gap',
			listings: gap.listings.map((item) => {
				const original = new URL(item.listingUrl),
					url = new URL(new URL(targetUrl).origin + '/');
				url.searchParams.set('list-type', '2');
				url.searchParams.set('prefix', original.searchParams.get('prefix')!);
				url.searchParams.set(
					'start-after',
					original.searchParams.get('marker')!
				);
				url.searchParams.set('max-keys', '2');
				return { ...item, listingUrl: url.href };
			})
		});
		expect(
			await db.query(
				'select count(*)::integer count from history_archive_listing_gap'
			)
		).toEqual([{ count: 1 }]);
	});

	it('accepts complete directory-range evidence without inventing a next filename', async () => {
		const gap = evidence();
		await fail(1, {
			...gap,
			kind: 'directory-listing-gap',
			missingThroughCheckpoint: 255,
			listings: gap.listings.map((item) => ({
				...item,
				listingUrl: targetUrl + '/' + item.category + '/00/00/00/',
				firstReturnedKey: null,
				firstReturnedCheckpoint: null,
				completePrefix: 'validator-us-west1-0/' + item.category + '/00/00/00/',
				rangeThroughCheckpoint: 255
			}))
		});
		expect(
			await db.query(
				'select "lastCheckpointLedger" from history_archive_listing_gap'
			)
		).toEqual([{ lastCheckpointLedger: 255 }]);
	});

	for (const defect of [
		'network',
		'status',
		'facts',
		'objects',
		'resolved'
	] as const) {
		it('does not jump with invalid boundary: ' + defect, async () => {
			await fail();
			if (defect === 'network')
				await db.query(
					'update history_archive_state_snapshot set "networkPassphrase"=\'other\' where "archiveUrlIdentity"=$1',
					[sourceProof.archiveUrlIdentity]
				);
			if (defect === 'status')
				await db.query(
					"update history_archive_checkpoint_proof set status='pending' where id=$1",
					[sourceProof.id]
				);
			if (defect === 'facts')
				await db.query(
					'update history_archive_checkpoint_proof set "proofFactsComplete"=false where id=$1',
					[sourceProof.id]
				);
			if (defect === 'objects')
				await db.query(
					'update history_archive_checkpoint_proof set "requiredObjectsComplete"=false where id=$1',
					[sourceProof.id]
				);
			if (defect === 'resolved')
				await db.query(
					'update history_archive_listing_gap set "resolvedAt"=now()'
				);
			expect(
				await db.query(historyArchiveListingGapAnchorSql('$1', '$2'), [
					targetUrl,
					lastMissing
				])
			).toEqual([]);
			await materializeNextCompactCheckpointPlans(db.manager, [
				{ archiveUrlIdentity: targetUrl, checkpointLedger: 127 }
			]);
			const rows = await db.query(
				'select "nextHistoricalCheckpointLedger" from history_archive_checkpoint_scan_cursor where "archiveUrlIdentity"=$1',
				[targetUrl]
			);
			expect(rows[0].nextHistoricalCheckpointLedger).toBeLessThan(resume);
		});
	}
});
