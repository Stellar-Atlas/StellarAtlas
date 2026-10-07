import { randomUUID } from 'node:crypto';
import type { HistoryArchiveContentReuseRequestV1 } from 'shared';
import { compactDbFixture } from './HistoryArchiveDbCompactTemplateFixture.js';
import { lookupReusableHistoryArchiveContent } from '../HistoryArchiveContentReuseLookup.js';
import { seedHistoryArchiveDbCompactTemplates } from '../HistoryArchiveDbCompactTemplateSeed.js';

jest.setTimeout(60_000);
describe('negotiated reference-only content lookup', () => {
	let fixture: Awaited<ReturnType<typeof compactDbFixture>>;
	const saved = {
		compact: process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED,
		db: process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED
	};
	beforeAll(async () => {
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = 'true';
		process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED = 'true';
		fixture = await compactDbFixture();
	});
	afterAll(async () => {
		if (saved.compact === undefined)
			delete process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED;
		else
			process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED = saved.compact;
		if (saved.db === undefined)
			delete process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED;
		else process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED = saved.db;
		await fixture.stop();
	});
	async function setup(warm = true) {
		const source = await fixture.source(),
			target = await source.target();
		const request: HistoryArchiveContentReuseRequestV1 = {
			responseFormat: 'compact-v2',
			remoteId: target.remoteId,
			executionId: target.progress.executionId!,
			claimAttempt: 1,
			objectType: 'ledger',
			objectKey: source.key,
			contentDigest: source.reuse.contentDigest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1
		};
		if (warm)
			await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [target]);
		return { source, target, request };
	}
	it('warm path succeeds without permission to read artifact verificationFacts and emits no arrays', async () => {
		const { source, target, request } = await setup();
		await fixture.db.query(`create role compact_wire_metadata_reader;
			grant select on history_archive_object_queue,history_archive_object_ready,history_archive_content_observation,history_archive_content_compact_template to compact_wire_metadata_reader;
			grant select(id,"sourceObjectRemoteId","sourceClaimAttempt","objectType","objectKey","checkpointLedger","contentDigest","contentRepresentation","derivationVersion","createdAt") on history_archive_content_artifact to compact_wire_metadata_reader;`);
		const result = await fixture.db.transaction(async (manager) => {
			await manager.query('set local role compact_wire_metadata_reader');
			return lookupReusableHistoryArchiveContent(manager, request);
		});
		expect(result).toEqual({
			...source.reuse,
			format: 'compact-v2',
			binding: {
				remoteId: target.remoteId,
				executionId: target.progress.executionId,
				claimAttempt: 1,
				objectType: 'ledger',
				objectKey: source.key,
				checkpointLedger: 63,
				sourceUrl: target.targetUrl
			},
			summary: {
				entryCount: 64,
				firstLedger: 0,
				lastLedger: 63,
				ledgerCount: 64,
				headerHashesVerified: true
			}
		});
		expect(JSON.stringify(result)).not.toMatch(/verificationFacts|"ledgers"/);
		await expect(
			fixture.db.transaction(async (manager) => {
				await manager.query('set local role compact_wire_metadata_reader');
				return lookupReusableHistoryArchiveContent(manager, {
					...request,
					responseFormat: undefined
				});
			})
		).rejects.toThrow(/permission denied/);
	});
	it('cold V2 and old clients preserve exact full V1 response', async () => {
		const { request } = await setup(false);
		const cold = await lookupReusableHistoryArchiveContent(
			fixture.db.manager,
			request
		);
		const old = await lookupReusableHistoryArchiveContent(fixture.db.manager, {
			...request,
			responseFormat: undefined
		});
		expect(cold).toEqual(old);
		expect(cold).toHaveProperty('verificationFacts.ledgerCategory.ledgers');
		expect(cold).not.toHaveProperty('format');
	});
	it('disabled compact database feature retains V1 even for a warm negotiated request', async () => {
		const { request } = await setup();
		process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED = 'false';
		try {
			expect(
				await lookupReusableHistoryArchiveContent(fixture.db.manager, request)
			).toHaveProperty('verificationFacts');
		} finally {
			process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED = 'true';
		}
	});
	it.each([
		'token',
		'attempt',
		'digest',
		'type',
		'key',
		'unpublished',
		'missingReady'
	] as const)(
		'does not return a reference for stale/mismatched %s',
		async (kind) => {
			const { request, target } = await setup();
			const bad = { ...request };
			if (kind === 'token') bad.executionId = randomUUID();
			if (kind === 'attempt') bad.claimAttempt = 2;
			if (kind === 'digest') bad.contentDigest = '0'.repeat(64);
			if (kind === 'type') bad.objectType = 'results';
			if (kind === 'key') bad.objectKey = 'ledger:0000007f';
			if (kind === 'unpublished')
				await fixture.db.query(
					`update history_archive_object_ready set "publishedAt"=null where "objectRemoteId"=$1`,
					[target.remoteId]
				);
			if (kind === 'missingReady')
				await fixture.db.query(
					`delete from history_archive_object_ready where "objectRemoteId"=$1`,
					[target.remoteId]
				);
			expect(
				await lookupReusableHistoryArchiveContent(fixture.db.manager, bad)
			).toBeNull();
		}
	);
	it('missing original observation cannot be hidden by an existing summary', async () => {
		const { request, source } = await setup();
		await fixture.db
			.transaction(async (manager) => {
				await manager.query(
					'alter table history_archive_content_observation disable trigger "TR_history_archive_content_observation_immutable"'
				);
				await manager.query(
					`delete from history_archive_content_observation where "objectRemoteId"=$1`,
					[source.sourceId]
				);
				expect(
					await lookupReusableHistoryArchiveContent(manager, request)
				).toBeNull();
				throw new Error('ROLLBACK_TEST_ONLY');
			})
			.catch((error) => {
				if (!(error instanceof Error) || error.message !== 'ROLLBACK_TEST_ONLY')
					throw error;
			});
	});
});
