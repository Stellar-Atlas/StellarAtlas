import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveRepairArtifactAvailabilityV1,
	HistoryArchiveRepairManifestV1,
	HistoryArchiveRepairObjectEvidenceV1,
	HistoryArchiveRepairSourceCandidateV1
} from 'shared';

const recheckEndpointPrefix = '/v1/archive-scans/objects';

export function createHistoryArchiveRepairManifest(input: {
	readonly actionId: string;
	readonly artifact: HistoryArchiveRepairArtifactAvailabilityV1 | null;
	readonly evidence: HistoryArchiveRepairObjectEvidenceV1;
	readonly object: HistoryArchiveObject;
	readonly source: HistoryArchiveRepairSourceCandidateV1 | undefined;
}): HistoryArchiveRepairManifestV1 {
	const replacement = toReplacement(input.artifact, input.source);
	return {
		actionId: input.actionId,
		evidence: input.evidence,
		generatedAt: input.evidence.updatedAt,
		recheck: {
			endpoint: `${recheckEndpointPrefix}/${input.object.remoteId}/recheck`,
			minimumEvidenceUpdatedAt: input.evidence.updatedAt,
			resolutionCondition: 'same-object-verified-after-original-evidence',
			targetRemoteId: input.object.remoteId
		},
		replacement,
		schemaVersion: 1,
		status: replacement === null ? 'awaiting-verified-replacement' : 'ready',
		steps:
			replacement === null
				? []
				: repairSteps(
						replacement.artifact.contentHash,
						input.evidence.failureClass === 'not-found'
					),
		target: {
			archiveUrl: input.object.archiveUrl,
			archiveUrlIdentity: input.object.archiveUrlIdentity,
			bucketHash: input.object.bucketHash,
			checkpointLedger: input.object.checkpointLedger,
			objectKey: input.object.objectKey,
			objectType: input.object.objectType,
			objectUrl: input.object.objectUrl,
			operatorTargetPathRequired: true
		}
	};
}

function toReplacement(
	artifact: HistoryArchiveRepairArtifactAvailabilityV1 | null,
	source: HistoryArchiveRepairSourceCandidateV1 | undefined
): HistoryArchiveRepairManifestV1['replacement'] {
	if (
		source === undefined ||
		artifact === null ||
		(artifact.status !== 'available' &&
			artifact.status !== 'verify-on-download')
	) {
		return null;
	}
	if (
		artifact.contentHash.digest !== source.proof.contentHash.digest ||
		artifact.contentHash.representation !==
			source.proof.contentHash.representation
	) {
		return null;
	}
	return { artifact, source };
}

function repairSteps(
	expectedContentHash: HistoryArchiveRepairManifestV1['replacement'] extends infer T
		? T extends { artifact: { contentHash: infer Hash } }
			? Hash
			: never
		: never,
	targetWasMissing: boolean
): HistoryArchiveRepairManifestV1['steps'] {
	return [
		{
			backupSuffix: '.stellaratlas-backup',
			kind: 'backup-current-file',
			order: 1,
			required: !targetWasMissing
		},
		{
			input: 'replacement-download-url',
			kind: 'stage-replacement',
			order: 2,
			required: true,
			stagingLocation: 'same-filesystem-temporary-file'
		},
		{
			expectedContentHash,
			kind: 'verify-staged-content',
			order: 3,
			required: true
		},
		{
			kind: 'preserve-metadata',
			order: 4,
			preserve: ['owner', 'mode', 'acl'],
			required: true
		},
		{
			kind: 'atomic-replace',
			order: 5,
			required: true,
			requiresSameFilesystem: true
		},
		{
			kind: 'request-recheck',
			order: 6,
			required: true,
			resolutionCondition: 'same-object-verified-after-original-evidence'
		}
	];
}
