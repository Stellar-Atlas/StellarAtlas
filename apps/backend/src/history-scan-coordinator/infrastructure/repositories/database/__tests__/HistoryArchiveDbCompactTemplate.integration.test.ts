import { randomUUID } from 'node:crypto';
import {
	compactDbFixture,
	observe,
	rejectCompactRecomputationSql
} from './HistoryArchiveDbCompactTemplateFixture.js';
import { seedHistoryArchiveDbCompactTemplates } from '../HistoryArchiveDbCompactTemplateSeed.js';
import { historyArchiveCompactContentFactsSql } from '../HistoryArchiveCompactContentFactsSql.js';
import { historyArchiveDbCompactTemplateValidationSql } from '../HistoryArchiveDbCompactTemplateSql.js';

jest.setTimeout(60_000);
describe('trusted artifact-once compact templates', () => {
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

	it('commits one DB-derived template per artifact and binds each current UTF-8 URL/attempt without recomputing arrays', async () => {
		const s = await fixture.source(),
			a = await s.target(),
			b = await s.target('https://二.example/é?x=✓', 123);
		await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a, b]);
		const [cached] = await fixture.db.query(
			`select template from history_archive_content_compact_template where "artifactId"=$1`,
			[s.reuse.artifactId]
		);
		expect(cached.template.contentReference.claimAttempt).toBe(0);
		expect(cached.template.ledgerCategory.sourceUrl).toBe('');
		expect(cached.template.ledgerCategory.sharedSummary).toEqual({
			firstLedger: 0,
			lastLedger: 63,
			ledgerCount: 64
		});
		await fixture.db.transaction(async (manager) => {
			await manager.query(rejectCompactRecomputationSql);
			await observe(manager, a.remoteId, s.reuse.artifactId, a.compact);
			await observe(manager, b.remoteId, s.reuse.artifactId, b.compact, 123);
			await manager.query(historyArchiveCompactContentFactsSql);
			await manager.query(historyArchiveDbCompactTemplateValidationSql);
		});
		const [{ count }] = await fixture.db.query(
			`select count(*)::integer count from history_archive_content_compact_template where "artifactId"=$1`,
			[s.reuse.artifactId]
		);
		expect(count).toBe(1);
	});
	it('cache miss retains original full validation and does not write a cache from the validator', async () => {
		const s = await fixture.source(),
			a = await s.target();
		await fixture.db.transaction((manager) =>
			observe(manager, a.remoteId, s.reuse.artifactId, a.compact)
		);
		expect(
			await fixture.db.query(
				`select 1 from history_archive_content_compact_template where "artifactId"=$1`,
				[s.reuse.artifactId]
			)
		).toEqual([]);
	});
	it('direct caller-supplied summary is discarded and all template mutations are forbidden', async () => {
		const s = await fixture.source();
		await fixture.db.query(
			`insert into history_archive_content_compact_template("artifactId",template) values($1,'{"forged":true}')`,
			[s.reuse.artifactId]
		);
		const [{ template }] = await fixture.db.query(
			`select template from history_archive_content_compact_template where "artifactId"=$1`,
			[s.reuse.artifactId]
		);
		expect(template.forged).toBeUndefined();
		expect(template.ledgerCategory.sharedSummary.ledgerCount).toBe(64);
		for (const sql of [
			`update history_archive_content_compact_template set template='{}' where "artifactId"=$1`,
			`delete from history_archive_content_compact_template where "artifactId"=$1`
		])
			await expect(fixture.db.query(sql, [s.reuse.artifactId])).rejects.toThrow(
				/append-only/
			);
		await expect(
			fixture.db.query('truncate history_archive_content_compact_template')
		).rejects.toThrow(/append-only/);
	});
	it.each([
		'summary',
		'digest',
		'source',
		'version',
		'referenceAttempt',
		'url',
		'key',
		'checkpoint',
		'category',
		'attempt'
	] as const)('rejects forged/stale %s on hot metadata path', async (kind) => {
		const s = await fixture.source(),
			a = await s.target();
		await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
		const bad = JSON.parse(JSON.stringify(a.compact));
		if (kind === 'summary') bad.ledgerCategory.sharedSummary.ledgerCount = 63;
		if (kind === 'digest') bad.content.digest = '0'.repeat(64);
		if (kind === 'source')
			bad.contentReference.sourceObjectRemoteId = randomUUID();
		if (kind === 'version') bad.contentReference.derivationVersion = 2;
		if (kind === 'referenceAttempt') bad.contentReference.claimAttempt = 2;
		if (kind === 'url')
			bad.ledgerCategory.sourceUrl = 'https://another-network.example';
		await expect(
			fixture.db.transaction(async (manager) => {
				if (kind === 'key')
					await manager.query(
						`update history_archive_object_queue set "objectKey"='ledger:0000007f' where "remoteId"=$1`,
						[a.remoteId]
					);
				if (kind === 'checkpoint')
					await manager.query(
						`update history_archive_object_queue set "checkpointLedger"=127 where "remoteId"=$1`,
						[a.remoteId]
					);
				if (kind === 'category')
					await manager.query(
						`update history_archive_object_queue set "objectType"='results' where "remoteId"=$1`,
						[a.remoteId]
					);
				await observe(
					manager,
					a.remoteId,
					s.reuse.artifactId,
					bad,
					kind === 'attempt' ? 2 : 1
				);
			})
		).rejects.toThrow(/does not match|accepted verification/);
		const [row] = await fixture.db.query(
			`select status from history_archive_object_queue where "remoteId"=$1`,
			[a.remoteId]
		);
		expect(row.status).toBe('pending');
	});
	it('fresh origin check remains mandatory even with a warm template', async () => {
		const s = await fixture.source(),
			a = await s.target();
		await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
		await expect(
			fixture.db.transaction(async (manager) => {
				await manager.query(
					'alter table history_archive_content_observation disable trigger "TR_history_archive_content_observation_immutable"'
				);
				await manager.query(
					`delete from history_archive_content_observation where "objectRemoteId"=$1`,
					[s.sourceId]
				);
				await observe(manager, a.remoteId, s.reuse.artifactId, a.compact);
			})
		).rejects.toThrow(/does not match/);
	});
	it('missing artifact/origin cannot create a trusted template', async () => {
		await expect(
			fixture.db.query(
				`insert into history_archive_content_compact_template("artifactId") values($1)`,
				[randomUUID()]
			)
		).rejects.toThrow(/no verified immutable origin/);
		const s = await fixture.source();
		await expect(
			fixture.db.transaction(async (manager) => {
				await manager.query(
					'alter table history_archive_content_observation disable trigger "TR_history_archive_content_observation_immutable"'
				);
				await manager.query(
					`delete from history_archive_content_observation where "objectRemoteId"=$1`,
					[s.sourceId]
				);
				await manager.query(
					`insert into history_archive_content_compact_template("artifactId") values($1)`,
					[s.reuse.artifactId]
				);
			})
		).rejects.toThrow(/no verified immutable origin/);
	});
	it('valid earlier item rolls back when later item fails validation; cached summary does not authorize partial success', async () => {
		const s = await fixture.source(),
			a = await s.target(),
			b = await s.target();
		await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
		const bad = JSON.parse(JSON.stringify(b.compact));
		bad.content.digest = '0'.repeat(64);
		await expect(
			fixture.db.transaction(async (manager) => {
				await observe(manager, a.remoteId, s.reuse.artifactId, a.compact);
				await observe(manager, b.remoteId, s.reuse.artifactId, bad);
			})
		).rejects.toThrow(/does not match/);
		expect(
			await fixture.db.query(
				`select 1 from history_archive_content_observation where "objectRemoteId"=any($1::uuid[])`,
				[[a.remoteId, b.remoteId]]
			)
		).toEqual([]);
	});
	it('inline legacy facts remain valid with or without a sidecar', async () => {
		const s = await fixture.source(),
			a = await s.target();
		await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
		await fixture.db.transaction((manager) =>
			observe(manager, a.remoteId, s.reuse.artifactId, {
				...s.facts,
				ledgerCategory: { ...s.facts.ledgerCategory, sourceUrl: a.targetUrl }
			})
		);
	});
	it('the existing proof resolver still returns the full exact immutable ledger facts after compact completion', async () => {
		const s = await fixture.source(),
			a = await s.target();
		await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
		await fixture.db.transaction((manager) =>
			observe(manager, a.remoteId, s.reuse.artifactId, a.compact)
		);
		const [row] = await fixture.db.query(
			`select history_archive_category_ledgers("remoteId",attempts,"objectType","objectKey","checkpointLedger","objectUrl","verificationFacts") as ledgers from history_archive_object_queue where "remoteId"=$1`,
			[a.remoteId]
		);
		expect(row.ledgers).toEqual(s.facts.ledgerCategory.ledgers);
	});
	it('seeds a bounded coalesced batch once, deduplicates artifact IDs, and avoids warm repeat queries', async () => {
		const s = await fixture.source(),
			t = await fixture.source();
		const input = [await s.target(), await t.target(), await s.target()];
		const transaction = jest.spyOn(fixture.db, 'transaction');
		try {
			await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, input);
			expect(transaction).toHaveBeenCalledTimes(1);
			await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, input);
			expect(transaction).toHaveBeenCalledTimes(1);
			const [{ count }] = await fixture.db.query(
				`select count(*)::integer count from history_archive_content_compact_template where "artifactId"=any($1::uuid[])`,
				[[s.reuse.artifactId, t.reuse.artifactId]]
			);
			expect(count).toBe(2);
		} finally {
			transaction.mockRestore();
		}
	});
	it.each(['token', 'attempt', 'unpublished'] as const)(
		'never seeds from an invalid %s claim',
		async (kind) => {
			const s = await fixture.source(),
				a = await s.target();
			if (kind === 'token') a.progress.executionId = randomUUID();
			if (kind === 'attempt') a.progress.claimAttempt = 2;
			if (kind === 'unpublished')
				await fixture.db.query(
					`update history_archive_object_ready set "publishedAt"=null where "objectRemoteId"=$1`,
					[a.remoteId]
				);
			await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
			expect(
				await fixture.db.query(
					`select 1 from history_archive_content_compact_template where "artifactId"=$1`,
					[s.reuse.artifactId]
				)
			).toEqual([]);
		}
	);
	it('lock failure rolls back only the separate seed, single-flights and backs off while original completion remains valid', async () => {
		const s = await fixture.source(),
			a = await s.target(),
			blocker = fixture.db.createQueryRunner();
		await blocker.connect();
		await blocker.startTransaction();
		await blocker.query(
			'lock table history_archive_content_compact_template in share mode'
		);
		const transaction = jest.spyOn(fixture.db, 'transaction');
		try {
			const first = seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [
				a
			]);
			await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
			await first;
			expect(transaction).toHaveBeenCalledTimes(1);
			await seedHistoryArchiveDbCompactTemplates(fixture.db.manager, [a]);
			expect(transaction).toHaveBeenCalledTimes(1);
			expect(
				await fixture.db.query(
					`select 1 from history_archive_content_compact_template where "artifactId"=$1`,
					[s.reuse.artifactId]
				)
			).toEqual([]);
			await fixture.db.transaction((manager) =>
				observe(manager, a.remoteId, s.reuse.artifactId, a.compact)
			);
		} finally {
			transaction.mockRestore();
			await blocker.rollbackTransaction();
			await blocker.release();
		}
	});
});
