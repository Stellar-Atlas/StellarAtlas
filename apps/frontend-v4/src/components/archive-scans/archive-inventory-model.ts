import type { PublicHistoryArchiveStatusSummary, PublicNode } from '@api/types';
import { formatInteger } from '@format/formatters';

export type ArchiveSource =
	PublicHistoryArchiveStatusSummary['sources'][number];
export type ArchiveInventorySort =
	| 'failures'
	| 'failures-asc'
	| 'organization'
	| 'organization-desc'
	| 'validator'
	| 'validator-desc'
	| 'coverage-desc'
	| 'coverage-asc'
	| 'url'
	| 'url-desc';

export const defaultArchiveInventorySort: ArchiveInventorySort =
	'coverage-desc';

export function hasArchiveSourceFindings(
	source: Pick<
		ArchiveSource,
		'archiveEvidenceFailures' | 'mismatchCheckpointProofs' | 'listingGapCount'
	>
): boolean {
	return (
		source.archiveEvidenceFailures > 0 ||
		source.mismatchCheckpointProofs > 0 ||
		(source.listingGapCount ?? 0) > 0
	);
}
const nameCollator = new Intl.Collator('en', {
	numeric: true,
	sensitivity: 'base'
});

export function groupAdvertisers(
	nodes: readonly PublicNode[]
): Map<string, PublicNode[]> {
	const grouped = new Map<string, PublicNode[]>();
	for (const node of nodes) {
		if (node.historyUrl === null) continue;
		const key = normalizeRoot(node.historyUrl);
		const entries = grouped.get(key) ?? [];
		entries.push(node);
		grouped.set(key, entries);
	}
	for (const entries of grouped.values()) {
		entries.sort((left, right) =>
			formatNodeName(left).localeCompare(formatNodeName(right))
		);
	}
	return grouped;
}

export function normalizeRoot(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname.replace(/\/+$/, '');
		return url.protocol.toLowerCase() + '//' + url.host.toLowerCase() + path;
	} catch {
		return value.replace(/\/+$/, '');
	}
}

export function formatNodeName(node: PublicNode): string {
	return node.name ?? node.alias ?? node.publicKey.slice(0, 12);
}

export function formatNullableInteger(value: number | null): string {
	return value === null ? 'none' : formatInteger(value);
}

export function getExpectedArchiveCheckpointCount(
	source: Pick<
		ArchiveSource,
		| 'currentLedger'
		| 'latestCheckpointLedger'
		| 'latestDiscoveredCheckpointLedger'
	>
): number {
	const knownLedgers = [
		source.currentLedger,
		source.latestCheckpointLedger,
		source.latestDiscoveredCheckpointLedger
	].filter((value): value is number => value !== null);
	if (knownLedgers.length === 0) return 0;
	const latestKnownLedger = Math.max(...knownLedgers);
	return latestKnownLedger < 63 ? 0 : Math.floor((latestKnownLedger + 1) / 64);
}

export function calculateCoveragePercent(
	verified: number,
	total: number
): number {
	if (total <= 0) return 0;
	return Math.min(100, Math.max(0, (verified / total) * 100));
}

export function formatCoveragePercent(value: number): string {
	if (value >= 100) return '100%';
	if (value > 99.999) return '>99.999%';
	if (value > 0 && value < 0.01) return '<0.01%';
	if (value >= 99.9) return value.toFixed(3) + '%';
	return value.toFixed(2) + '%';
}

interface ArchiveSortContext {
	readonly advertisers: ReadonlyMap<string, readonly PublicNode[]>;
	readonly organizationNames: ReadonlyMap<string, string>;
	readonly sortMode: ArchiveInventorySort;
}

export function compareSources(
	left: ArchiveSource,
	right: ArchiveSource,
	context: ArchiveSortContext
): number {
	const reverseMode = {
		'organization-desc': 'organization',
		'validator-desc': 'validator',
		'url-desc': 'url',
		'failures-asc': 'failures'
	} as const;
	if (context.sortMode in reverseMode) {
		const sortMode = reverseMode[context.sortMode as keyof typeof reverseMode];
		return -compareSources(left, right, { ...context, sortMode });
	}
	if (context.sortMode === 'organization') {
		return compareOrganizationThenValidator(left, right, context);
	}
	if (context.sortMode === 'validator') {
		return (
			compareNames(
				advertiserSortKey(left, context),
				advertiserSortKey(right, context)
			) || compareOrganizationThenValidator(left, right, context)
		);
	}
	if (
		context.sortMode === 'coverage-desc' ||
		context.sortMode === 'coverage-asc'
	) {
		const coverageOrder = coverageRatio(left) - coverageRatio(right);
		if (coverageOrder !== 0) {
			return context.sortMode === 'coverage-desc'
				? -coverageOrder
				: coverageOrder;
		}
		return compareOrganizationThenValidator(left, right, context);
	}
	if (context.sortMode === 'url') {
		return compareRootUrls(left, right);
	}

	const remoteOrder =
		right.archiveEvidenceFailures - left.archiveEvidenceFailures;
	if (remoteOrder !== 0) return remoteOrder;
	const mismatchOrder =
		right.mismatchCheckpointProofs - left.mismatchCheckpointProofs;
	if (mismatchOrder !== 0) return mismatchOrder;
	const proofOrder =
		right.durableVerifiedCheckpointProofs -
		left.durableVerifiedCheckpointProofs;
	return proofOrder !== 0
		? proofOrder
		: compareOrganizationThenValidator(left, right, context);
}

function sourceAdvertisers(
	source: ArchiveSource,
	context: ArchiveSortContext
): readonly PublicNode[] {
	return context.advertisers.get(normalizeRoot(source.archiveUrl)) ?? [];
}

function organizationSortKey(
	source: ArchiveSource,
	context: ArchiveSortContext
): string {
	const names = sourceAdvertisers(source, context)
		.map((node) => formatOrganizationName(node, context.organizationNames))
		.filter((name) => name !== 'unaffiliated')
		.toSorted(compareNames);
	return names[0] ?? '\uffff';
}

function advertiserSortKey(
	source: ArchiveSource,
	context: ArchiveSortContext
): string {
	const advertisers = sourceAdvertisers(source, context);
	const validators = advertisers.filter((node) => node.isValidator);
	const candidates = validators.length > 0 ? validators : advertisers;
	return candidates.map(formatNodeName).toSorted(compareNames)[0] ?? '\uffff';
}

export function formatOrganizationName(
	node: PublicNode,
	organizationNames: ReadonlyMap<string, string>
): string {
	if (node.organizationId === null) return 'unaffiliated';
	return (
		organizationNames.get(node.organizationId) ??
		node.homeDomain ??
		node.organizationId
	);
}

function coverageRatio(source: ArchiveSource): number {
	const expected = getExpectedArchiveCheckpointCount(source);
	return expected === 0 ? 0 : source.durableVerifiedCheckpointProofs / expected;
}

function compareOrganizationThenValidator(
	left: ArchiveSource,
	right: ArchiveSource,
	context: ArchiveSortContext
): number {
	return (
		compareNames(
			organizationSortKey(left, context),
			organizationSortKey(right, context)
		) ||
		compareNames(
			advertiserSortKey(left, context),
			advertiserSortKey(right, context)
		) ||
		compareRootUrls(left, right)
	);
}

function compareNames(left: string, right: string): number {
	// Roots without organization/advertiser metadata follow named roots.
	if (left === '\uffff' || right === '\uffff') {
		return left === right ? 0 : left === '\uffff' ? 1 : -1;
	}
	return nameCollator.compare(left, right) || compareExactText(left, right);
}

function compareRootUrls(left: ArchiveSource, right: ArchiveSource): number {
	return (
		compareNames(left.archiveUrl, right.archiveUrl) ||
		compareExactText(left.archiveUrlIdentity, right.archiveUrlIdentity)
	);
}

function compareExactText(left: string, right: string): number {
	return left === right ? 0 : left < right ? -1 : 1;
}

export function matchesArchiveSource(
	source: ArchiveSource,
	query: string,
	advertisers: readonly PublicNode[],
	organizationNames: ReadonlyMap<string, string>
): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	return [
		source.archiveUrl,
		...advertisers.flatMap((node) => [
			formatNodeName(node),
			node.publicKey,
			formatOrganizationName(node, organizationNames)
		])
	].some((value) => value.toLocaleLowerCase().includes(needle));
}
