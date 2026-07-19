'use client';

import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import { StatusPill } from '@components/status/status-ui';
import {
	formatArchiveObjectTypeLabel,
	sanitizeArchiveEvidenceText
} from '@domain/history-archive';
import { formatArchiveRoot } from '@domain/known-archive-evidence';
import { formatDateTime, formatInteger } from '@format/formatters';

interface NodeArchiveRepairPlanProps {
	readonly repairPlan: PublicHistoryArchiveRepairPlan;
}

export function NodeArchiveRepairPlan({
	repairPlan
}: NodeArchiveRepairPlanProps): React.JSX.Element {
	const hasActions = repairPlan.actions.length > 0;
	const hasBlocks = repairPlan.infrastructureBlocks.length > 0;

	if (!hasActions && !hasBlocks) {
		return (
			<p className="archive-good-state">
				No confirmed repair actions yet. The scanner is still collecting
				checkpoint proof and will list repairable archive files only after it
				has concrete failure evidence.
			</p>
		);
	}

	return (
		<div aria-label="Confirmed repair evidence" className="archive-repair-plan">
			{hasActions ? <RepairActionTable repairPlan={repairPlan} /> : null}
			{hasBlocks ? <InfrastructureBlockTable repairPlan={repairPlan} /> : null}
		</div>
	);
}

function RepairActionTable({
	repairPlan
}: {
	readonly repairPlan: PublicHistoryArchiveRepairPlan;
}): React.JSX.Element {
	return (
		<div
			aria-label="Confirmed archive repair evidence"
			className="responsive-table known-evidence-table-wrap"
			role="region"
			tabIndex={0}
		>
			<table className="archive-object-table archive-repair-table known-evidence-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>Failed file</th>
						<th>Finding</th>
						<th>Verified replacement</th>
					</tr>
				</thead>
				<tbody>
					{repairPlan.actions.map((action) => (
						<tr key={action.actionId}>
							<td data-label="Status">
								<StatusPill
									status={action.severity === 'error' ? 'degraded' : 'ok'}
									text={formatSeverity(action.severity)}
									tone={action.severity === 'blocked' ? 'warning' : undefined}
								/>
							</td>
							<td data-label="Failed file">
								<strong>{formatActionSubject(action)}</strong>
								<small>{formatActionEvidence(action)}</small>
							</td>
							<td data-label="Finding">
								<strong>{formatActionReason(action.reason)}</strong>
							</td>
							<td data-label="Replacement">
								{formatReplacementReadiness(action)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function InfrastructureBlockTable({
	repairPlan
}: {
	readonly repairPlan: PublicHistoryArchiveRepairPlan;
}): React.JSX.Element {
	return (
		<details className="metadata-document">
			<summary>
				<span>Scanner infrastructure blocks</span>
				<span className="muted-inline">
					{formatInteger(repairPlan.infrastructureBlocks.length)} blocks
				</span>
			</summary>
			<div
				aria-label="Scanner infrastructure blocks"
				className="responsive-table known-evidence-table-wrap"
				role="region"
				tabIndex={0}
			>
				<table className="archive-object-table">
					<thead>
						<tr>
							<th>Evidence class</th>
							<th>Host</th>
							<th>Failure</th>
							<th>Backoff</th>
						</tr>
					</thead>
					<tbody>
						{repairPlan.infrastructureBlocks.map((block, index) => (
							<tr key={`${block.hostIdentity}:${block.failureClass}:${index}`}>
								<td data-label="Evidence class">{block.evidenceClass}</td>
								<td data-label="Host">
									{sanitizeArchiveEvidenceText(block.hostIdentity)}
								</td>
								<td data-label="Failure">
									<strong>{block.failureClass}</strong>
									<small>{block.summary}</small>
								</td>
								<td data-label="Backoff">
									{block.blockedUntil
										? formatDateTime(block.blockedUntil)
										: 'not scheduled'}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</details>
	);
}

function formatActionEvidence(
	action: PublicHistoryArchiveRepairPlan['actions'][number]
): string {
	const objectEvidence = action.evidence[0];
	if (objectEvidence) {
		const checkpoint =
			objectEvidence.checkpointLedger === null
				? 'No checkpoint'
				: `Checkpoint ${formatInteger(objectEvidence.checkpointLedger)}`;
		return `${checkpoint} / ${objectEvidence.objectKey}`;
	}

	const checkpointEvidence = action.checkpointEvidence[0];
	if (checkpointEvidence) {
		return `checkpoint ${formatInteger(
			checkpointEvidence.checkpointLedger
		)} / ${checkpointEvidence.status}`;
	}

	return 'No detailed evidence returned.';
}

function formatActionSubject(
	action: PublicHistoryArchiveRepairPlan['actions'][number]
): string {
	const objectEvidence = action.evidence[0];
	if (objectEvidence) {
		return formatArchiveObjectTypeLabel(objectEvidence.objectType);
	}
	if (action.checkpointEvidence.length > 0) {
		return 'Checkpoint file consistency';
	}
	return 'Archive evidence';
}

function formatReplacementReadiness(
	action: PublicHistoryArchiveRepairPlan['actions'][number]
): React.JSX.Element {
	const artifact = action.repairArtifact;
	const candidate = action.knownGoodSources[0];
	if (artifact?.status === 'available' && action.severity === 'blocked') {
		return (
			<>
				<strong>Replacement blocked</strong>
				<small>
					Local bucket bytes match the expected hash, but source-bound
					verification evidence is not complete.
				</small>
			</>
		);
	}
	if (artifact?.status === 'available') {
		return (
			<>
				<a className="primary-button" href={artifact.downloadUrl}>
					Download verified file
				</a>
				<small>
					Local bytes reverified {formatDateTime(artifact.provenAt)}
				</small>
				{candidate ? <CandidateProof candidate={candidate} /> : null}
			</>
		);
	}
	if (artifact?.status === 'verify-on-download') {
		return (
			<>
				<a className="primary-button" href={artifact.downloadUrl}>
					Verify and download
				</a>
				<small>
					The source proof is current as of {formatDateTime(artifact.provenAt)}.
					StellarAtlas returns bytes only after their{' '}
					{artifact.contentHash.representation} SHA-256 matches this proof.
				</small>
				{candidate ? <CandidateProof candidate={candidate} /> : null}
			</>
		);
	}
	if (artifact?.status === 'unavailable') {
		return (
			<>
				<strong>Replacement blocked</strong>
				<small>
					{formatArtifactReason(artifact.reason)};{' '}
					{formatInteger(action.knownGoodSources.length)} attributed source
					records
				</small>
			</>
		);
	}

	const candidates = action.knownGoodSources;
	if (candidates.length === 0) {
		return (
			<span className="muted-inline">
				No proof-gated replacement download available
			</span>
		);
	}

	if (candidate === undefined) {
		return (
			<span className="muted-inline">
				No proof-gated replacement download available
			</span>
		);
	}

	return (
		<>
			<strong>Proof-bound source found; download pending</strong>
			<small>
				StellarAtlas will not offer replacement bytes until they are locally
				reverified
			</small>
			<CandidateProof candidate={candidate} />
			{candidates.length > 1 ? (
				<small>{formatInteger(candidates.length - 1)} alternate sources</small>
			) : null}
		</>
	);
}

function CandidateProof({
	candidate
}: {
	readonly candidate: PublicHistoryArchiveRepairPlan['actions'][number]['knownGoodSources'][number];
}): React.JSX.Element {
	const proof = candidate.proof;
	return (
		<small>
			{formatArchiveRoot(candidate.archiveUrl)} / checkpoint{' '}
			{formatInteger(proof.checkpointLedger)} / proof {proof.proofId} v
			{proof.proofVersion} / {proof.anchor.kind} ({proof.anchor.sourceCount}{' '}
			{proof.anchor.sourceCount === 1 ? 'source' : 'sources'}) / SHA-256{' '}
			{shortDigest(proof.contentHash.digest)}
		</small>
	);
}

function shortDigest(value: string): string {
	return value.length <= 20
		? value
		: `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function formatArtifactReason(reason: string): string {
	return reason.replaceAll('-', ' ');
}

function formatActionReason(
	reason: PublicHistoryArchiveRepairPlan['actions'][number]['reason']
): string {
	return reason.replaceAll('-', ' ');
}

function formatSeverity(
	severity: PublicHistoryArchiveRepairPlan['actions'][number]['severity']
): string {
	if (severity === 'error') return 'repair';
	if (severity === 'blocked') return 'blocked';
	return 'waiting';
}
