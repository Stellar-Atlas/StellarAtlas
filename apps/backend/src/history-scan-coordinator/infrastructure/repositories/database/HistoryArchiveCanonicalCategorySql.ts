import { historyArchiveScpExpectationSql } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';

const expectsScpSql = historyArchiveScpExpectationSql({
	checkpointLedgerSql: 'desired.checkpoint_ledger',
	networkPassphraseSql: 'checkpoint."networkPassphrase"',
	protocolVersionSql: '1'
});

export const canonicalCategoryTargetsCteSql = `
category_targets as materialized (
	select checkpoint."archiveUrl", checkpoint."archiveUrlIdentity",
		checkpoint."hostIdentity", desired.object_type,
		desired.checkpoint_ledger, desired.object_key,
		desired.object_order, desired.category, desired.extension,
		desired.object_priority
	from checkpoints checkpoint
	cross join lateral (
		values
			(
				'ledger', checkpoint."checkpointLedger" - 64,
				'ledger:' || lpad(
					to_hex(checkpoint."checkpointLedger" - 64), 8, '0'
				), 20, 'ledger', 'xdr.gz', 0
			),
			(
				'ledger', checkpoint."checkpointLedger",
				'ledger:' || lpad(to_hex(checkpoint."checkpointLedger"), 8, '0'),
				20, 'ledger', 'xdr.gz', 1
			),
			(
				'transactions', checkpoint."checkpointLedger",
				'transactions:' || lpad(
					to_hex(checkpoint."checkpointLedger"), 8, '0'
				), 30, 'transactions', 'xdr.gz', 2
			),
			(
				'results', checkpoint."checkpointLedger",
				'results:' || lpad(to_hex(checkpoint."checkpointLedger"), 8, '0'),
				40, 'results', 'xdr.gz', 3
			),
			(
				'scp', checkpoint."checkpointLedger",
				'scp:' || lpad(to_hex(checkpoint."checkpointLedger"), 8, '0'),
				45, 'scp', 'xdr.gz', 4
			)
	) desired(
		object_type, checkpoint_ledger, object_key, object_order,
		category, extension, object_priority
	)
	where (desired.object_type <> 'scp' or ${expectsScpSql})
		and (desired.object_priority > 0
		or (
			checkpoint."checkpointLedger" > 63
			and exists (
				select 1
				from "history_archive_object_queue" predecessor
				where predecessor."archiveUrlIdentity" =
					checkpoint."archiveUrlIdentity"
					and predecessor."objectType" = 'checkpoint-state'
					and predecessor."objectKey" = 'checkpoint-state:' || lpad(
						to_hex(checkpoint."checkpointLedger" - 64), 8, '0'
					)
					and predecessor.status = 'verified'
			)
		))
), inserted_categories as (
	insert into "history_archive_object_queue" (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
		"objectType", "objectKey", "objectOrder", "objectUrl",
		status, "checkpointLedger", "dependencyReady",
		"executionDisposition", "executionReason",
		"executionDispositionAt", "createdAt", "updatedAt"
	)
	select gen_random_uuid(), target."archiveUrl", target."archiveUrlIdentity",
		target."hostIdentity", target.object_type, target.object_key,
		target.object_order,
		rtrim(target."archiveUrl", '/') || '/' || target.category || '/' ||
			substring(checkpoint_hex.hex from 1 for 2) || '/' ||
			substring(checkpoint_hex.hex from 3 for 2) || '/' ||
			substring(checkpoint_hex.hex from 5 for 2) || '/' ||
			target.category || '-' || checkpoint_hex.hex || '.' ||
			target.extension,
		'pending', target.checkpoint_ledger, true, 'deferred',
		'canonical-frontier-materialization', now(), now(), now()
	from category_targets target
	cross join lateral (
		select lpad(to_hex(target.checkpoint_ledger), 8, '0') as hex
	) checkpoint_hex
	on conflict ("archiveUrlIdentity", "objectType", "objectKey")
		do nothing
	returning id
)
`;
