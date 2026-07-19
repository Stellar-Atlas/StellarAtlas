import type { PublicKnownOrganizationArchiveEvidence } from '@api/archive-evidence-types';
import { KnownArchiveEvidence } from './known-archive-evidence';

export function OrganizationArchiveEvidence({
	evidence,
	organizationId
}: {
	readonly evidence: PublicKnownOrganizationArchiveEvidence;
	readonly organizationId: string;
}): React.JSX.Element {
	return (
		<KnownArchiveEvidence
			evidence={evidence}
			subject={{ id: organizationId, kind: 'organization' }}
			title="Organization archive health"
		/>
	);
}
