'use client';

import { getArchiveRepairDownloadPath } from '@api/archive-repair-download-path';
import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import { StatusPill } from '@components/status/status-ui';
import {
	formatArchiveObjectTypeLabel,
	sanitizeArchiveEvidenceText
} from '@domain/history-archive';
import { formatArchiveRoot } from '@domain/known-archive-evidence';
import { formatDateTime, formatInteger } from '@format/formatters';
import {
	ArchivistWholeArchiveOption,
	getValidatedArchiveRelativePath,
	ProofBoundRepairWorkflow
} from './node-archive-repair-workflow';

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
			<div className="archive-repair-plan">
				<p className="archive-good-state">
					No proof-bound file action is currently available. This can mean there
					is no actionable failure or that exact replacement proof is
					incomplete. Review the evidence before choosing broader remediation.
				</p>
				<ArchivistWholeArchiveOption />
			</div>
		);
	}

	return (
		<div aria-label="Confirmed repair evidence" className="archive-repair-plan">
			{hasActions ? <RepairActionTable repairPlan={repairPlan} /> : null}
			{hasBlocks ? <InfrastructureBlockTable repairPlan={repairPlan} /> : null}
			<ArchivistWholeArchiveOption />
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
								<RepairActionGuidance action={action} />
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

function RepairActionGuidance({
	action
}: {
	readonly action: PublicHistoryArchiveRepairPlan['actions'][number];
}): React.JSX.Element {
	const evidence = action.evidence[0];
	const nextAttemptAt = evidence?.nextAttemptAt;
	return (
		<details className="archive-repair-guidance">
			<summary>Repair instructions</summary>
			{evidence && action.repairManifest?.status !== 'ready' ? (
				<dl>
					<dt>Target path</dt>
					<dd>
						<code>
							{getValidatedArchiveRelativePath(
								evidence.archiveUrl,
								evidence.objectUrl
							) ?? 'not safely derivable'}
						</code>
					</dd>
					<dt>
						{action.reason === 'access-denied' ? 'Access repair' : 'Placement'}
					</dt>
					<dd>
						{action.reason === 'access-denied' ? (
							<>
								Restore anonymous HTTP GET and HEAD access to this exact
								case-sensitive path. If the storage provider masks absent keys
								as HTTP 403, inspect the object inventory first; publish the
								proof-bound replacement only when the key is actually absent.
							</>
						) : (
							<>
								Keep the existing object as a backup. Publish the verified bytes
								at the same path using the archive backend&apos;s atomic
								promotion method, preserving its access permissions and content
								headers.
							</>
						)}
					</dd>
				</dl>
			) : null}
			<ProofBoundRepairWorkflow action={action} />
			<p>{action.summary}</p>
			{nextAttemptAt ? (
				<small>
					The scanner will automatically make this file eligible for recheck
					after {formatDateTime(nextAttemptAt)}.
				</small>
			) : null}
		</details>
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
	const downloadPath =
		artifact?.status === 'available' ||
		artifact?.status === 'verify-on-download'
			? getArchiveRepairDownloadPath(artifact.downloadUrl)
			: null;
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
	if (artifact?.status === 'available' && downloadPath !== null) {
		return (
			<>
				<a className="primary-button" href={downloadPath}>
					Operator-authenticated download
				</a>
				<small>
					Local bytes reverified {formatDateTime(artifact.provenAt)}
				</small>
				{candidate ? <CandidateProof candidate={candidate} /> : null}
			</>
		);
	}
	if (artifact?.status === 'verify-on-download' && downloadPath !== null) {
		return (
			<>
				<a className="primary-button" href={downloadPath}>
					Operator-authenticated verify and download
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
	if (
		artifact?.status === 'unavailable' ||
		((artifact?.status === 'available' ||
			artifact?.status === 'verify-on-download') &&
			downloadPath === null)
	) {
		return (
			<>
				<strong>Replacement blocked</strong>
				<small>
					{artifact.status === 'unavailable'
						? formatArtifactReason(artifact.reason)
						: 'Invalid repair artifact download path'}
					; {formatInteger(action.knownGoodSources.length)} attributed source
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
