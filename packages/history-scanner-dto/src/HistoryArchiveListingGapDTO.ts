export interface HistoryArchiveListingGapDTO {
	readonly kind: 'gcs-listing-gap' | 's3-listing-gap' | 'directory-listing-gap';
	readonly archiveRoot: string;
	readonly missingFromCheckpoint: number;
	readonly missingThroughCheckpoint: number;
	readonly observedAt: string;
	readonly listings: readonly {
		readonly category: 'history' | 'ledger' | 'transactions' | 'results';
		readonly listingUrl: string;
		readonly responseSha256: string;
		readonly firstReturnedKey: string | null;
		readonly firstReturnedCheckpoint: number | null;
		/** Key subtree completely enumerated, or shown absent by its parent index. */
		readonly completePrefix?: string;
		readonly rangeThroughCheckpoint?: number;
	}[];
}

const categories = ['history', 'ledger', 'transactions', 'results'] as const;
const checkpoint = (value: unknown): value is number =>
	typeof value === 'number' &&
	Number.isSafeInteger(value) &&
	value >= 63 &&
	value <= 2147483583 &&
	value % 64 === 63;
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function directoryEnd(
	item: Record<string, unknown>,
	root: URL,
	url: URL,
	from: number
): number | null {
	if (
		item.firstReturnedKey !== null ||
		item.firstReturnedCheckpoint !== null ||
		typeof item.completePrefix !== 'string' ||
		item.completePrefix.length > 2048 ||
		!checkpoint(item.rangeThroughCheckpoint) ||
		item.rangeThroughCheckpoint < from ||
		url.origin !== root.origin ||
		url.search ||
		/%(?:2f|5c|00)/i.test(url.pathname)
	)
		return null;
	const rootPrefix = decodeURIComponent(root.pathname)
		.replace(/^\//, '')
		.replace(/\/+$/, '');
	const base = (rootPrefix ? rootPrefix + '/' : '') + item.category + '/';
	if (!item.completePrefix.startsWith(base)) return null;
	const suffix = item.completePrefix.slice(base.length);
	if (!/^(?:[0-9a-f]{2}\/){1,3}$/.test(suffix)) return null;
	const hexPrefix = suffix.replaceAll('/', '');
	const lower = Number.parseInt(hexPrefix.padEnd(8, '0'), 16);
	const upper = Number.parseInt(hexPrefix.padEnd(8, 'f'), 16);
	if (from < lower || from > upper || item.rangeThroughCheckpoint > upper)
		return null;
	const listedPath = decodeURIComponent(url.pathname);
	const subtreePath = '/' + item.completePrefix;
	const parentPath = subtreePath.slice(
		0,
		subtreePath.slice(0, -1).lastIndexOf('/') + 1
	);
	if (listedPath !== subtreePath && listedPath !== parentPath) return null;
	return item.rangeThroughCheckpoint;
}

export function isHistoryArchiveListingGapDTO(
	value: unknown
): value is HistoryArchiveListingGapDTO {
	if (
		!record(value) ||
		!['gcs-listing-gap', 's3-listing-gap', 'directory-listing-gap'].includes(
			String(value.kind)
		) ||
		typeof value.archiveRoot !== 'string' ||
		value.archiveRoot.length > 2048 ||
		!checkpoint(value.missingFromCheckpoint) ||
		!checkpoint(value.missingThroughCheckpoint) ||
		value.missingThroughCheckpoint <= value.missingFromCheckpoint ||
		typeof value.observedAt !== 'string' ||
		!Number.isFinite(Date.parse(value.observedAt)) ||
		!Array.isArray(value.listings) ||
		value.listings.length !== 4
	)
		return false;
	try {
		const root = new URL(value.archiveRoot);
		if (
			!['http:', 'https:'].includes(root.protocol) ||
			root.username ||
			root.password ||
			root.search ||
			root.hash
		)
			return false;
		const seen = new Set<string>();
		const ends: number[] = [];
		for (const item of value.listings) {
			if (
				!record(item) ||
				!categories.some((category) => category === item.category) ||
				typeof item.category !== 'string' ||
				seen.has(item.category) ||
				typeof item.listingUrl !== 'string' ||
				item.listingUrl.length > 4096 ||
				typeof item.responseSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/.test(item.responseSha256)
			)
				return false;
			const url = new URL(item.listingUrl);
			if (
				url.username ||
				url.password ||
				url.hash ||
				url.searchParams.has('delimiter')
			)
				return false;
			if (value.kind === 'directory-listing-gap') {
				const end = directoryEnd(item, root, url, value.missingFromCheckpoint);
				if (end === null) return false;
				ends.push(end);
			} else {
				if (
					typeof item.firstReturnedKey !== 'string' ||
					item.firstReturnedKey.length > 2048 ||
					!checkpoint(item.firstReturnedCheckpoint) ||
					item.firstReturnedCheckpoint <= value.missingThroughCheckpoint ||
					item.completePrefix !== undefined ||
					item.rangeThroughCheckpoint !== undefined
				)
					return false;
				if (
					value.kind === 'gcs-listing-gap'
						? url.origin !== 'https://storage.googleapis.com'
						: url.origin !== root.origin ||
							url.searchParams.get('list-type') !== '2'
				)
					return false;
				const prefix = url.searchParams.get('prefix');
				if (
					prefix === null ||
					!(
						prefix === item.category + '/' ||
						prefix.endsWith('/' + item.category + '/')
					) ||
					url.searchParams.get('max-keys') !== '2'
				)
					return false;
				const key = (position: number) => {
					const hex = position.toString(16).padStart(8, '0');
					return (
						prefix +
						hex.slice(0, 2) +
						'/' +
						hex.slice(2, 4) +
						'/' +
						hex.slice(4, 6) +
						'/' +
						item.category +
						'-' +
						hex +
						(item.category === 'history' ? '.json' : '.xdr.gz')
					);
				};
				if (
					item.firstReturnedKey !== key(item.firstReturnedCheckpoint) ||
					url.searchParams.get(
						value.kind === 'gcs-listing-gap' ? 'marker' : 'start-after'
					) !==
						(value.missingFromCheckpoint === 63
							? prefix
							: key(value.missingFromCheckpoint - 64))
				)
					return false;
				ends.push(item.firstReturnedCheckpoint - 64);
			}
			seen.add(item.category);
		}
		return value.missingThroughCheckpoint === Math.min(...ends);
	} catch {
		return false;
	}
}
