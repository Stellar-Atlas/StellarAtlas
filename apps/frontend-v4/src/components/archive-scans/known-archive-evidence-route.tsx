import { ApiClientError } from '@api/client';
import {
	fetchKnownNodeArchiveEvidence,
	fetchKnownOrganizationArchiveEvidence,
	type KnownArchiveEvidenceQuery
} from '@api/known-network-client';
import { NodeArchiveEvidence } from '@components/nodes/node-archive-evidence';
import {
	archiveEvidenceCopyLimit,
	archiveEvidencePageLimit
} from '@domain/known-archive-evidence';
import { ArchiveEvidenceRouteState } from './archive-evidence-route-state';
import { OrganizationArchiveEvidence } from './organization-archive-evidence';

const initialEvidenceQuery = {
	copyLimit: archiveEvidenceCopyLimit,
	eventLimit: 0,
	failureLimit: archiveEvidencePageLimit,
	objectLimit: 0,
	objectStatus: 'failed',
	workerIssueLimit: archiveEvidencePageLimit
} as const satisfies KnownArchiveEvidenceQuery;

const liveEvidenceOptions = {
	cache: 'no-store'
} as const;

export async function NodeArchiveEvidenceRoute({
	publicKey
}: {
	readonly publicKey: string;
}): Promise<React.JSX.Element> {
	const title = 'Archive evidence';
	try {
		const evidence = await fetchKnownNodeArchiveEvidence(
			publicKey,
			initialEvidenceQuery,
			liveEvidenceOptions
		);
		if (evidence === null) {
			return <ArchiveEvidenceRouteState state="absent" title={title} />;
		}
		return <NodeArchiveEvidence evidence={evidence} publicKey={publicKey} />;
	} catch (error) {
		if (isExpectedUnavailable(error)) {
			return <ArchiveEvidenceRouteState state="unavailable" title={title} />;
		}
		throw error;
	}
}

export async function OrganizationArchiveEvidenceRoute({
	organizationId
}: {
	readonly organizationId: string;
}): Promise<React.JSX.Element> {
	const title = 'Organization archive evidence';
	try {
		const evidence = await fetchKnownOrganizationArchiveEvidence(
			organizationId,
			initialEvidenceQuery,
			liveEvidenceOptions
		);
		if (evidence === null) {
			return <ArchiveEvidenceRouteState state="absent" title={title} />;
		}
		return (
			<OrganizationArchiveEvidence
				evidence={evidence}
				organizationId={organizationId}
			/>
		);
	} catch (error) {
		if (isExpectedUnavailable(error)) {
			return <ArchiveEvidenceRouteState state="unavailable" title={title} />;
		}
		throw error;
	}
}

function isExpectedUnavailable(error: unknown): boolean {
	if (error instanceof ApiClientError) {
		const status = error.statusCode;
		return (
			status === undefined || status === 408 || status === 429 || status >= 500
		);
	}
	return (
		error instanceof TypeError ||
		(error instanceof Error && error.name === 'AbortError')
	);
}
