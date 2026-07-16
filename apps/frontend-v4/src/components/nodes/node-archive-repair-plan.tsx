'use client';

import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import { StatusPill } from '@components/status/status-ui';
import {
	formatArchiveObjectTypeLabel,
	sanitizeArchiveEvidenceText
} from '@domain/history-archive';
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
		<div className="responsive-table">
			<table className="archive-object-table archive-repair-table">
				<thead>
					<tr>
						<th>Status</th>
						<th>Repair action</th>
						<th>Evidence</th>
						<th>Replacement readiness</th>
					</tr>
				</thead>
				<tbody>
					{repairPlan.actions.map((action) => (
						<tr key={action.actionId}>
							<td>
								<StatusPill
									status={action.severity === 'error' ? 'degraded' : 'ok'}
									text={formatSeverity(action.severity)}
									tone={action.severity === 'blocked' ? 'warning' : undefined}
								/>
							</td>
							<td>
								<strong>{formatActionKind(action.kind)}</strong>
								<small>{action.summary}</small>
							</td>
							<td>
								<strong>{formatActionReason(action.reason)}</strong>
								<small>{formatActionEvidence(action)}</small>
							</td>
							<td>{formatReplacementReadiness(action)}</td>
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
			<div className="responsive-table">
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
								<td>{block.evidenceClass}</td>
								<td>{sanitizeArchiveEvidenceText(block.hostIdentity)}</td>
								<td>
									<strong>{block.failureClass}</strong>
									<small>{block.summary}</small>
								</td>
								<td>
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
		const fileLabel = formatArchiveObjectTypeLabel(objectEvidence.objectType);
		const checkpoint =
			objectEvidence.checkpointLedger === null
				? ''
				: ` / checkpoint ${formatInteger(objectEvidence.checkpointLedger)}`;
		return `${fileLabel}${checkpoint} / ${objectEvidence.objectKey}`;
	}

	const checkpointEvidence = action.checkpointEvidence[0];
	if (checkpointEvidence) {
		return `checkpoint ${formatInteger(
			checkpointEvidence.checkpointLedger
		)} / ${checkpointEvidence.status}`;
	}

	return 'No detailed evidence returned.';
}

function formatReplacementReadiness(
	action: PublicHistoryArchiveRepairPlan['actions'][number]
): React.JSX.Element {
	const artifact = action.repairArtifact;
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
					Download verified bucket
				</a>
				<small>
					SHA-256 proven {formatDateTime(artifact.provenAt)};{' '}
					{formatInteger(action.knownGoodSources.length)} attributed source
					records
				</small>
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

	const first = candidates[0];
	if (first === undefined) {
		return (
			<span className="muted-inline">
				No proof-gated replacement download available
			</span>
		);
	}

	return (
		<>
			<strong>
				{formatInteger(candidates.length)} candidate source records
			</strong>
			<small>
				Use the verified replacement evidence table below before downloading
			</small>
		</>
	);
}

function formatArtifactReason(reason: string): string {
	return reason.replaceAll('-', ' ');
}

function formatActionKind(
	kind: PublicHistoryArchiveRepairPlan['actions'][number]['kind']
): string {
	if (kind === 'restore-history-archive-state') {
		return 'Restore history archive state';
	}
	if (kind === 'replace-bucket-file') return 'Replace bucket file';
	if (kind === 'replace-archive-file') return 'Replace archive file';
	if (kind === 'repair-checkpoint-proof') {
		return 'Repair checkpoint consistency';
	}
	return 'Waiting for scanner proof';
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
