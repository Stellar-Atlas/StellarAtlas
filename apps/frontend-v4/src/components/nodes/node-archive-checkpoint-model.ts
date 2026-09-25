import { isHistoryArchiveInconclusiveTransportFailure } from 'shared';
import type {
	PublicHistoryArchiveObjectType,
	PublicKnownArchiveRemoteFailure,
	PublicKnownArchiveRootEvidence
} from '../../api/archive-evidence-types';
import { sourceCheckpointCoverage } from '../archive-scans/archive-source-overview';

export const checkpointFiles: readonly {
	readonly type: PublicHistoryArchiveObjectType;
	readonly label: string;
	readonly path: string;
	readonly purpose: string;
}[] = [
	{
		type: 'history-archive-state',
		label: 'Archive state',
		path: '.well-known/stellar-history.json',
		purpose:
			'Advertises the latest checkpoint and bucket list; one root document, not one file per checkpoint.'
	},
	{
		type: 'checkpoint-state',
		label: 'Checkpoint state',
		path: 'history/aa/bb/cc/history-XXXXXXXX.json',
		purpose: 'The checkpoint’s bucket-list state.'
	},
	{
		type: 'ledger',
		label: 'Ledger headers',
		path: 'ledger/aa/bb/cc/ledger-XXXXXXXX.xdr.gz',
		purpose: 'Ledger headers, hashes and previous-ledger links.'
	},
	{
		type: 'transactions',
		label: 'Transactions',
		path: 'transactions/aa/bb/cc/transactions-XXXXXXXX.xdr.gz',
		purpose: 'Transaction sets for the checkpoint’s ledgers.'
	},
	{
		type: 'results',
		label: 'Transaction results',
		path: 'results/aa/bb/cc/results-XXXXXXXX.xdr.gz',
		purpose: 'Recorded transaction outcomes checked against ledger commitments.'
	},
	{
		type: 'bucket',
		label: 'Buckets',
		path: 'bucket/aa/bb/cc/bucket-HASH.xdr.gz',
		purpose:
			'Hash-addressed state files referenced by checkpoint state; a bucket can serve many checkpoints.'
	},
	{
		type: 'scp',
		label: 'SCP history',
		path: 'scp/aa/bb/cc/scp-XXXXXXXX.xdr.gz',
		purpose:
			'Separate consensus-message evidence; not part of the required checkpoint proof. Reading it does not authenticate SCP signatures.'
	}
];

export interface NodeArchiveFileFinding {
	readonly type: PublicHistoryArchiveObjectType;
	readonly label: string;
	readonly count: number;
	readonly reasons: readonly string[];
}

/** Classifies only the supplied page, never an inferred whole-root error total. */
export function nodeArchiveCheckpointModel(
	root: PublicKnownArchiveRootEvidence,
	failures: readonly PublicKnownArchiveRemoteFailure[]
): ReturnType<typeof sourceCheckpointCoverage> & {
	readonly findings: readonly NodeArchiveFileFinding[];
	readonly inconclusiveOnPage: number;
} {
	const groups = new Map<
		PublicHistoryArchiveObjectType,
		{ count: number; reasons: Set<string> }
	>();
	let inconclusiveOnPage = 0;
	for (const failure of failures) {
		if (failure.object.archiveUrlIdentity !== root.archiveUrlIdentity) continue;
		const retained = failure.retainedFinding;
		const error = failure.object.error;
		if (!retained && !error) continue;
		const finding = retained ?? {
			errorType: error?.type ?? null,
			errorMessage: error?.message ?? null,
			httpStatus: error?.httpStatus ?? null
		};
		if (isHistoryArchiveInconclusiveTransportFailure(finding)) {
			inconclusiveOnPage += 1;
			continue;
		}
		const type = failure.object.objectType;
		const group = groups.get(type) ?? { count: 0, reasons: new Set<string>() };
		group.count += 1;
		group.reasons.add(
			finding.httpStatus === 404
				? 'HTTP 404: file not found at the requested URL'
				: finding.httpStatus === 403
					? 'HTTP 403: access denied; file existence unknown'
					: finding.httpStatus !== null &&
						  (finding.httpStatus < 200 || finding.httpStatus >= 300)
						? `HTTP ${finding.httpStatus}: source request failed`
						: 'Archive content check failed'
		);
		groups.set(type, group);
	}
	return {
		...sourceCheckpointCoverage(root),
		inconclusiveOnPage,
		findings: checkpointFiles.flatMap((file) => {
			const group = groups.get(file.type);
			return group
				? [
						{
							type: file.type,
							label: file.label,
							count: group.count,
							reasons: [...group.reasons]
						}
					]
				: [];
		})
	};
}
