import { unstable_cache } from 'next/cache';
import { fetchHistoryArchiveObjectStatusSummary } from './archive-scans-client';
import { fetchPublicNodes, fetchPublicOrganizations } from './client';
import type { ArchiveInventorySnapshot } from './archive-inventory-snapshot';

const requestOptions = { cache: 'no-store', timeoutMs: 10_000 } as const;
const fetchAdvertisers = unstable_cache(
	async () => {
		const [nodes, organizations] = await Promise.all([
			fetchPublicNodes(requestOptions),
			fetchPublicOrganizations(requestOptions)
		]);
		return { nodes, organizations };
	},
	['archive-inventory-advertisers-v1'],
	{ revalidate: 300 }
);

export const fetchArchiveInventorySnapshot = unstable_cache(
	async (): Promise<ArchiveInventorySnapshot> => {
		const [summary, advertisers] = await Promise.all([
			fetchHistoryArchiveObjectStatusSummary(requestOptions),
			fetchAdvertisers()
		]);
		return { summary, ...advertisers };
	},
	['archive-inventory-snapshot-v1'],
	{ revalidate: 15 }
);
