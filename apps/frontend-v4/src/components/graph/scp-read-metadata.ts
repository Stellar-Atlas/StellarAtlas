import type { PublicScpStatementReadMetadata } from '../../api/types';

export const formatScpReadMetadataLabel = (
	metadata: PublicScpStatementReadMetadata | null
): string => {
	if (metadata === null) return 'connecting';
	const source = metadata.source === 'meilisearch' ? 'live index' : 'canonical';
	return `${metadata.freshness} / ${source}`;
};

export const formatScpReadMetadataTitle = (
	metadata: PublicScpStatementReadMetadata | null
): string => {
	if (metadata === null) return 'Waiting for live SCP read metadata';
	const age =
		metadata.freshnessMs === null
			? 'age unavailable'
			: `${metadata.freshnessMs} ms old`;
	return `Source: ${metadata.source}; ${age}; observed: ${
		metadata.observedAt ?? 'unavailable'
	}`;
};
