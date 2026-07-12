import { historyArchiveScpExpectationSql } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';

const expectsScpSql = historyArchiveScpExpectationSql({
	checkpointLedgerSql: 'desired.checkpoint_ledger',
	networkPassphraseSql: 'checkpoint."networkPassphrase"',
	protocolVersionSql: '1'
});

export const canonicalCategoryTargetsCteSql = `
predecessor_checkpoint_targets as materialized (
	select checkpoint."archiveUrl", checkpoint."archiveUrlIdentity",
		checkpoint."hostIdentity",
		checkpoint."checkpointLedger" - 64 as checkpoint_ledger,
		'checkpoint-state:' || lpad(
			to_hex(checkpoint."checkpointLedger" - 64), 8, '0'
		) as object_key
	from checkpoints checkpoint
	where checkpoint."checkpointLedger" > 63
), inserted_predecessor_checkpoints as (
	insert into "history_archive_object_queue" (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
		"objectType", "objectKey", "objectOrder", "objectUrl",
		status, "checkpointLedger", "dependencyReady",
		"executionDisposition", "executionReason",
		"executionDispositionAt", "createdAt", "updatedAt"
	)
	select gen_random_uuid(), target."archiveUrl", target."archiveUrlIdentity",
		target."hostIdentity", 'checkpoint-state', target.object_key, 10,
		rtrim(target."archiveUrl", '/') || '/history/' ||
			substring(checkpoint_hex.hex from 1 for 2) || '/' ||
			substring(checkpoint_hex.hex from 3 for 2) || '/' ||
			substring(checkpoint_hex.hex from 5 for 2) || '/' ||
			'history-' || checkpoint_hex.hex || '.json',
		'pending', target.checkpoint_ledger, true, 'deferred',
		'canonical-frontier-materialization', now(), now(), now()
	from predecessor_checkpoint_targets target
	cross join lateral (
		select lpad(to_hex(target.checkpoint_ledger), 8, '0') as hex
	) checkpoint_hex
	on conflict ("archiveUrlIdentity", "objectType", "objectKey")
		do nothing
	returning id
), category_targets as materialized (
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

export const canonicalCategoryAdmissionCteSql = `
category_objects as materialized (
	select network_root."archiveUrlIdentity",
		network_root."lastClaimedAt", network_root.proof_progress,
		network_root.target_lane,
		desired.object_type,
		desired.checkpoint_ledger as object_checkpoint_ledger,
		desired.object_key, desired.object_priority
	from network_roots network_root
	cross join lateral (
		values
			(
				'checkpoint-state', network_root.checkpoint_ledger - 64,
				'checkpoint-state:' || lpad(
					to_hex(network_root.checkpoint_ledger - 64), 8, '0'
				), -2
			),
			(
				'checkpoint-state', network_root.checkpoint_ledger,
				'checkpoint-state:' || lpad(
					to_hex(network_root.checkpoint_ledger), 8, '0'
				), -1
			),
			(
				'ledger', network_root.checkpoint_ledger - 64,
				'ledger:' || lpad(
					to_hex(network_root.checkpoint_ledger - 64), 8, '0'
				), 0
			),
			(
				'ledger', network_root.checkpoint_ledger,
				'ledger:' || lpad(to_hex(network_root.checkpoint_ledger), 8, '0'),
				1
			),
			(
				'transactions', network_root.checkpoint_ledger,
				'transactions:' || lpad(
					to_hex(network_root.checkpoint_ledger), 8, '0'
				), 2
			),
			(
				'results', network_root.checkpoint_ledger,
				'results:' || lpad(
					to_hex(network_root.checkpoint_ledger), 8, '0'
				), 3
			),
			(
				'scp', network_root.checkpoint_ledger,
				'scp:' || lpad(to_hex(network_root.checkpoint_ledger), 8, '0'), 4
			)
	) desired(object_type, checkpoint_ledger, object_key, object_priority)
	where desired.checkpoint_ledger >= 63
		and (
			desired.object_priority <> -2
			or not exists (
				select 1
				from network_roots other_root
				where other_root."archiveUrlIdentity" =
					network_root."archiveUrlIdentity"
					and other_root.target_lane <> network_root.target_lane
					and other_root.checkpoint_ledger = desired.checkpoint_ledger
			)
		)
)
`;
