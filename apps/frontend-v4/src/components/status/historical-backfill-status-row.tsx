import type {
	PublicHistoricalFullHistoryBackfill,
	PublicHistoricalFullHistoryCheckpointProof,
	PublicHistoricalFullHistoryProofFailureKind,
	PublicStatusLevel
} from '@api/types';
import { formatInteger } from '@format/formatters';
import { StatusRow, type StatusPillTone } from './status-ui';

export function HistoricalBackfillStatusRow({
	backfill
}: {
	readonly backfill: PublicHistoricalFullHistoryBackfill | null;
}): React.JSX.Element | null {
	if (backfill === null) return null;
	const status: PublicStatusLevel =
		backfill.state === 'failed' ? 'degraded' : 'ok';
	return (
		<StatusRow
			detail={historicalBackfillDetail(backfill)}
			label="Historical index backfill"
			pillText={historicalBackfillPill(backfill)}
			status={status}
			tone={historicalBackfillTone(backfill)}
			value={historicalBackfillValue(backfill)}
		/>
	);
}

function historicalBackfillValue(
	backfill: PublicHistoricalFullHistoryBackfill
): string {
	const checkpoint =
		backfill.currentProof?.checkpointLedger ?? backfill.nextCheckpointLedger;
	if (backfill.completedCheckpoints !== undefined) {
		const completed = `${formatInteger(backfill.completedCheckpoints)} checkpoints indexed`;
		if (backfill.state === 'complete')
			return `${completed}; full history indexed`;
		if (checkpoint === null) return completed;
		const formattedCheckpoint = formatInteger(Number(checkpoint));
		const proof = backfill.currentProof;
		if (proof !== undefined && proof !== null) {
			if (proof.remainingBucketCount > 0) {
				return `${completed}; checkpoint ${formattedCheckpoint} needs ${formatInteger(proof.remainingBucketCount)} more bucket checks on best source`;
			}
			if (proof.status === 'verified') {
				return `${completed}; checkpoint ${formattedCheckpoint} proof checks complete`;
			}
			return `${completed}; checkpoint ${formattedCheckpoint} ${shortProofBlocker(proof.failureKind)}`;
		}
		return `${completed}; checkpoint ${formattedCheckpoint} has no current source aggregate`;
	}

	if (backfill.state === 'complete') return 'Full history indexed';
	if (backfill.state === 'running') {
		return `Processing ${formatCheckpoint(checkpoint)}`;
	}
	if (backfill.state === 'queued') {
		return `Queued ${formatCheckpoint(checkpoint)}`;
	}
	if (backfill.state === 'failed') return 'Backfill needs attention';
	return `${formatCheckpoint(checkpoint)} progress unavailable`;
}

function historicalBackfillDetail(
	backfill: PublicHistoricalFullHistoryBackfill
): string {
	const activity = `${formatInteger(backfill.runningJobs)} active, ${formatInteger(backfill.pendingJobs)} queued`;
	if (
		backfill.completedJobs === undefined ||
		backfill.currentProof === undefined
	) {
		return `Completed progress and current source evidence are unavailable; ${activity}`;
	}
	const completed = `${formatInteger(backfill.completedJobs)} proof-gated backfill jobs completed`;
	if (backfill.currentProof === null) {
		return `${completed}; no current source proof aggregate recorded; ${activity}`;
	}
	return `${completed}; ${describeProofEvidence(backfill.currentProof)}; ${activity}`;
}

function describeProofEvidence(
	proof: PublicHistoricalFullHistoryCheckpointProof
): string {
	const bucketProgress = `best source verified ${formatInteger(proof.verifiedBucketCount)} of ${formatInteger(proof.expectedBucketCount)} required buckets`;
	if (proof.failedBucketCount > 0) {
		return `${bucketProgress}; ${formatInteger(proof.failedBucketCount)} bucket checks failed`;
	}
	if (proof.remainingBucketCount > 0) {
		return `${bucketProgress}; ${formatInteger(proof.remainingBucketCount)} bucket checks still pending`;
	}
	const finding = describeProofFailure(proof.failureKind);
	return finding === null
		? bucketProgress
		: `${bucketProgress}; archive-source finding: ${finding}`;
}

function describeProofFailure(
	failureKind: PublicHistoricalFullHistoryProofFailureKind | null
): string | null {
	if (failureKind === null) return null;
	const descriptions: Readonly<
		Record<PublicHistoricalFullHistoryProofFailureKind, string>
	> = {
		'bucket-missing': 'required bucket verification is incomplete',
		'checkpoint-bucket-list-mismatch': 'checkpoint bucket list does not match',
		'checkpoint-ledger-mismatch': 'checkpoint ledger does not match',
		'object-failed': 'a required archive object failed verification',
		'object-incomplete': 'required archive objects are incomplete',
		'predecessor-missing': 'the predecessor checkpoint is missing',
		'previous-ledger-hash-mismatch': 'previous ledger hashes do not match',
		'proof-facts-incomplete': 'required checkpoint facts are incomplete',
		'result-hash-mismatch': 'transaction result hashes do not match',
		'transaction-hash-mismatch': 'transaction hashes do not match'
	};
	return descriptions[failureKind];
}

function shortProofBlocker(
	failureKind: PublicHistoricalFullHistoryProofFailureKind | null
): string {
	const description = describeProofFailure(failureKind);
	return description === null
		? 'needs additional proof checks on best source'
		: `blocked because ${description}`;
}

function historicalBackfillPill(
	backfill: PublicHistoricalFullHistoryBackfill
): string {
	if (backfill.state === 'idle') return 'Ready';
	if (backfill.state === 'waiting-for-proof') {
		return hasArchiveSourceFinding(backfill.currentProof)
			? 'Source finding'
			: 'Proof checks pending';
	}
	if (backfill.state === 'complete') return 'Complete';
	if (backfill.state === 'running') return 'Active';
	if (backfill.state === 'queued') return 'Queued';
	return 'Needs attention';
}

function hasArchiveSourceFinding(
	proof: PublicHistoricalFullHistoryCheckpointProof | null | undefined
): boolean {
	if (proof === null || proof === undefined) return false;
	if (proof.failedBucketCount > 0) return true;
	return proof.status === 'mismatch';
}

function historicalBackfillTone(
	backfill: PublicHistoricalFullHistoryBackfill
): StatusPillTone | undefined {
	return backfill.state === 'waiting-for-proof' ? 'neutral' : undefined;
}

function formatCheckpoint(checkpoint: string | null): string {
	return checkpoint === null
		? 'next checkpoint'
		: `checkpoint ${formatInteger(Number(checkpoint))}`;
}
