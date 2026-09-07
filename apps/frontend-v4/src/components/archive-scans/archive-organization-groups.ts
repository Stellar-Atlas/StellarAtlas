import { getArchiveFaultCount } from './archive-finding-model';
import type { PublicNode } from '@api/types';
import {
	type ArchiveSource,
	calculateCoveragePercent,
	compareSources,
	formatOrganizationName,
	getExpectedArchiveCheckpointCount,
	getKnownScannedPositions,
	normalizeRoot
} from './archive-inventory-model';

type SortContext = Parameters<typeof compareSources>[2];
export interface ArchiveOrganizationGroup {
	readonly key: string;
	readonly name: string;
	readonly shared: boolean;
	readonly sources: readonly ArchiveSource[];
	readonly verifiedPositions: number;
	readonly expectedPositions: number;
	readonly verifiedPercent: number | null;
	readonly scannedPositions: number;
	readonly remoteFailures: number | null;
}

const collator = new Intl.Collator('en', {
	numeric: true,
	sensitivity: 'base'
});
const compareText = (a: string, b: string): number =>
	collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** A shared source has one joint attribution group, never duplicate organization rows. */
export function groupArchiveSources(
	sources: readonly ArchiveSource[],
	context: SortContext
): readonly ArchiveOrganizationGroup[] {
	const distinct = new Map<string, ArchiveSource>();
	for (const source of sources) {
		const identity = normalizeRoot(source.archiveUrlIdentity);
		const previous = distinct.get(identity);
		// Prefer the latest snapshot if duplicate normalized identities are supplied.
		if (
			!previous ||
			source.observedAt > previous.observedAt ||
			(source.observedAt === previous.observedAt &&
				compareText(source.archiveUrl, previous.archiveUrl) < 0)
		) {
			distinct.set(identity, source);
		}
	}
	const groups = new Map<
		string,
		{ name: string; shared: boolean; sources: ArchiveSource[] }
	>();
	for (const source of distinct.values()) {
		const nodes =
			context.advertisers.get(normalizeRoot(source.archiveUrl)) ?? [];
		const attribution = groupAttribution(nodes, context.organizationNames);
		const group = groups.get(attribution.key) ?? {
			...attribution,
			sources: []
		};
		group.sources.push(source);
		groups.set(attribution.key, group);
	}
	return [...groups]
		.map(([key, group]): ArchiveOrganizationGroup => {
			const rows = group.sources.toSorted((a, b) =>
				compareSources(a, b, context)
			);
			const expectedPositions = rows.reduce(
				(total, row) => total + getExpectedArchiveCheckpointCount(row),
				0
			);
			const verifiedPositions = rows.reduce(
				(total, row) => total + row.durableVerifiedCheckpointProofs,
				0
			);
			return {
				key,
				name: group.name,
				shared: group.shared,
				sources: rows,
				expectedPositions,
				verifiedPositions,
				verifiedPercent: rows.some(
					(row) => getExpectedArchiveCheckpointCount(row) === 0
				)
					? null
					: calculateCoveragePercent(verifiedPositions, expectedPositions),
				scannedPositions: rows.reduce(
					(total, row) => total + getKnownScannedPositions(row),
					0
				),
				remoteFailures: rows.some((row) => getArchiveFaultCount(row) === null)
					? null
					: rows.reduce(
							(total, row) => total + (getArchiveFaultCount(row) ?? 0),
							0
						)
			};
		})
		.toSorted((a, b) => compareGroups(a, b, context));
}

function groupAttribution(
	nodes: readonly PublicNode[],
	names: ReadonlyMap<string, string>
) {
	const organizations = new Map<string, string>();
	for (const node of nodes) {
		if (node.organizationId !== null)
			organizations.set(
				node.organizationId,
				formatOrganizationName(node, names)
			);
	}
	const ids = [...organizations.keys()].toSorted(compareText);
	if (ids.length === 0)
		return {
			key: nodes.length === 0 ? 'unadvertised' : 'unaffiliated',
			name:
				nodes.length === 0
					? 'No current advertiser'
					: 'Unaffiliated validators and listeners',
			shared: false
		};
	const labels = ids.map((id) => organizations.get(id)!).toSorted(compareText);
	return {
		key: JSON.stringify(ids),
		name: (ids.length > 1 ? 'Shared by ' : '') + labels.join(' · '),
		shared: ids.length > 1
	};
}

function compareGroups(
	a: ArchiveOrganizationGroup,
	b: ArchiveOrganizationGroup,
	context: SortContext
): number {
	const mode = context.sortMode;
	let order = 0;
	if (mode.startsWith('coverage-') || mode.startsWith('scan-coverage-')) {
		if (a.verifiedPercent === null || b.verifiedPercent === null) {
			if (a.verifiedPercent !== b.verifiedPercent)
				return a.verifiedPercent === null ? 1 : -1;
		} else {
			const ratio = (group: ArchiveOrganizationGroup) =>
				mode.startsWith('scan-')
					? group.scannedPositions / group.expectedPositions
					: group.verifiedPositions / group.expectedPositions;
			order = ratio(a) - ratio(b);
			if (mode.endsWith('desc')) order = -order;
		}
	} else if (mode === 'organization' || mode === 'organization-desc') {
		order =
			compareText(a.name, b.name) * (mode === 'organization-desc' ? -1 : 1);
	} else if (mode === 'failures' || mode === 'failures-asc') {
		if (a.remoteFailures === null || b.remoteFailures === null) {
			return a.remoteFailures === b.remoteFailures
				? compareText(a.name, b.name)
				: a.remoteFailures === null
					? 1
					: -1;
		}
		order =
			(a.remoteFailures - b.remoteFailures) * (mode === 'failures' ? -1 : 1);
	} else {
		order = compareSources(a.sources[0]!, b.sources[0]!, context);
	}
	return order || compareText(a.name, b.name) || compareText(a.key, b.key);
}

/** Page whole groups, so all roots for an attribution remain together. */
export function archiveGroupPage(
	groups: readonly ArchiveOrganizationGroup[],
	requestedPage: number,
	size = 6
) {
	const currentPage = Math.min(
		Math.max(0, requestedPage),
		Math.max(0, Math.ceil(groups.length / size) - 1)
	);
	const first = currentPage * size;
	const visible = groups.slice(first, first + size);
	return {
		currentPage,
		first,
		visible,
		hasNext: first + size < groups.length,
		rootCount: groups.reduce((total, group) => total + group.sources.length, 0),
		visibleRootCount: visible.reduce(
			(total, group) => total + group.sources.length,
			0
		)
	};
}
