import type { PublicScpStatementReadMetadata } from '../../api/types';
import type { LiveNetworkStreamState } from '../../api/live-network-stream';

export const formatScpReadMetadataLabel = (
	metadata: PublicScpStatementReadMetadata | null,
	stream?: LiveNetworkStreamState
): string => {
	if (stream?.status === 'reconnecting') return 'reconnecting';
	if (stream?.status === 'stale') return 'stream stalled';
	if (metadata === null) return 'connecting';
	const source = metadata.source === 'meilisearch' ? 'live index' : 'canonical';
	if (metadata.truncated === true || stream?.truncated === true) {
		return `catching up / ${source}`;
	}
	return `${metadata.freshness} / ${source}`;
};

export const formatScpReadMetadataTitle = (
	metadata: PublicScpStatementReadMetadata | null,
	stream?: LiveNetworkStreamState
): string => {
	const streamLabel = stream
		? `Stream: ${stream.status}; reconnect attempt: ${stream.reconnectAttempt}`
		: 'Stream state unavailable';
	if (metadata === null) return `${streamLabel}; waiting for SCP read metadata`;
	const age =
		metadata.freshnessMs === null
			? 'age unavailable'
			: `${metadata.freshnessMs} ms old`;
	const cursor = metadata.cursor ?? stream?.cursor;
	return `${streamLabel}; source: ${metadata.source}; ${age}; observed: ${
		metadata.observedAt ?? 'unavailable'
	}; cursor: ${cursor?.statementHash ?? 'unavailable'}; truncated: ${
		metadata.truncated === true || stream?.truncated === true ? 'yes' : 'no'
	}`;
};
