import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { startDisposablePostgres } from '@test-support/DisposablePostgres.js';
import { HistoryArchiveContentReuseMigration1785520000000 } from '../../../database/migrations/1785520000000-HistoryArchiveContentReuseMigration.js';
import { historyArchiveCompactContentFactsSql } from '../HistoryArchiveCompactContentFactsSql.js';
import {
	historyArchiveDbCompactTemplateSchemaSql,
	historyArchiveDbCompactTemplateValidationSql
} from '../HistoryArchiveDbCompactTemplateSql.js';
import { contentFactsForStorage } from '../HistoryArchiveCompactContentFacts.js';
import { compactTemplateCache } from '../HistoryArchiveCompactTemplateCache.js';
import { recordHistoryArchiveContentEvidence } from '../HistoryArchiveContentReuseWrite.js';
import type { HistoryArchiveContentReuseV1 } from 'shared';
import type { HistoryArchiveObjectProgressUpdate } from '../../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';

export async function compactDbFixture() {
	const postgres = await startDisposablePostgres();
	const db = new DataSource({ type: 'postgres', url: postgres.url });
	await db.initialize();
	await db.query(`create table history_archive_object_queue (
		"remoteId" uuid primary key, "objectType" text not null, "objectKey" text not null,
		"checkpointLedger" integer, status text not null, attempts integer not null,
		"verificationFacts" jsonb, "objectUrl" text not null);
		create table history_archive_object_ready (
		"objectRemoteId" uuid primary key references history_archive_object_queue("remoteId"),
		"dispatchToken" uuid, "claimAttempt" integer, "publishedAt" timestamptz);`);
	const runner = db.createQueryRunner();
	await runner.connect();
	await new HistoryArchiveContentReuseMigration1785520000000().up(runner);
	await runner.release();
	await db.query(historyArchiveCompactContentFactsSql);
	await db.query(historyArchiveDbCompactTemplateSchemaSql('pg_default'));
	await db.query(historyArchiveDbCompactTemplateValidationSql);
	async function source() {
		const sourceId = randomUUID(),
			digest = sourceId.replaceAll('-', '').repeat(2),
			key = 'ledger:0000003f';
		const url = `https://source.example/${sourceId}`;
		const facts = {
			content: {
				algorithm: 'sha256',
				digest,
				representation: 'uncompressed-xdr'
			},
			ledgerCategory: {
				entryCount: 64,
				headerHashesVerified: true,
				sourceUrl: url,
				ledgers: Array.from({ length: 64 }, (_, ledger) => ({
					ledger,
					bucketListHash: 'b'.repeat(64),
					ledgerHeaderHash: 'c'.repeat(64),
					previousLedgerHeaderHash: 'd'.repeat(64),
					protocolVersion: 29,
					transactionResultSetHash: 'e'.repeat(64),
					transactionSetHash: 'f'.repeat(64)
				}))
			}
		};
		await db.query(
			`insert into history_archive_object_queue values($1,'ledger',$2,63,'verified',1,$3,$4)`,
			[sourceId, key, facts, url]
		);
		await recordHistoryArchiveContentEvidence(db.manager, sourceId, {
			progress: { claimAttempt: 1, verificationFacts: facts },
			reuse: null
		});
		const [row] = await db.query(
			`select id from history_archive_content_artifact where "sourceObjectRemoteId"=$1`,
			[sourceId]
		);
		const reuse: HistoryArchiveContentReuseV1 = {
			artifactId: row.id,
			sourceObjectRemoteId: sourceId,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1
		};
		compactTemplateCache(db.manager).put({
			reuse,
			progress: { claimAttempt: 1, verificationFacts: facts }
		});
		async function target(
			targetUrl = 'https://target.example/é-東京',
			attempt = 1
		) {
			const remoteId = randomUUID(),
				executionId = randomUUID();
			const targetFacts = {
				...facts,
				ledgerCategory: { ...facts.ledgerCategory, sourceUrl: targetUrl }
			};
			const progress: HistoryArchiveObjectProgressUpdate = {
				claimAttempt: attempt,
				executionId,
				scheduler: 'broker',
				contentReuse: reuse
			};
			await db.query(
				`insert into history_archive_object_queue values($1,'ledger',$2,63,'pending',0,null,$3)`,
				[remoteId, key, targetUrl]
			);
			await db.query(
				`insert into history_archive_object_ready values($1,$2,$3,now())`,
				[remoteId, executionId, attempt]
			);
			const compact = contentFactsForStorage(
				{ reuse, progress: { ...progress, verificationFacts: targetFacts } },
				true
			);
			return { remoteId, progress, compact, targetUrl };
		}
		return { sourceId, reuse, facts, key, url, target };
	}
	return {
		db,
		source,
		async stop() {
			await db.destroy();
			await postgres.stop();
		}
	};
}

export async function observe(
	manager: EntityManager,
	remoteId: string,
	artifactId: string,
	compact: unknown,
	attempt = 1
) {
	await manager.query(
		`update history_archive_object_queue set status='verified',attempts=$3,"verificationFacts"=$2 where "remoteId"=$1`,
		[remoteId, compact, attempt]
	);
	await manager.query(
		`insert into history_archive_content_observation("objectRemoteId","artifactId","claimAttempt") values($1,$2,$3)`,
		[remoteId, artifactId, attempt]
	);
}

// Test-only tripwire: a hot observation must not invoke the large-JSON path.
export const rejectCompactRecomputationSql = `create or replace function history_archive_compact_content_facts(
	facts jsonb,object_type text,source_url text,artifact_id uuid,source_object_id uuid,derivation_version integer,claim_attempt integer
) returns jsonb language plpgsql immutable strict as $f$ begin raise exception 'LARGE_FACTS_PATH_EXECUTED'; end $f$;`;
