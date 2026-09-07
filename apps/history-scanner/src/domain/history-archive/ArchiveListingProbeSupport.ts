import type { GcsArchiveListingGapInput } from './GcsArchiveListingGapProbe.js';
import { checkpointKey, validCheckpoint } from './GcsArchiveListingGapProbe.js';

export class UnavailableListingCapabilityCache {
	private readonly entries = new Map<string, number>();
	has(root: string, at: number): boolean {
		const until = this.entries.get(root);
		if (until === undefined) return false;
		this.entries.delete(root);
		if (until <= at) return false;
		this.entries.set(root, until);
		return true;
	}
	mark(root: string, at: number): void {
		this.entries.delete(root);
		if (this.entries.size >= 256)
			this.entries.delete(this.entries.keys().next().value!);
		this.entries.set(root, at + 3_600_000);
	}
}

export function listingInputRoot(input: GcsArchiveListingGapInput): URL | null {
	if (
		input.observedHttpStatus !== 404 ||
		!validCheckpoint(input.checkpoint) ||
		input.archiveRoot.length > 2048
	)
		return null;
	try {
		const root = new URL(input.archiveRoot);
		if (
			!['http:', 'https:'].includes(root.protocol) ||
			root.username ||
			root.password ||
			root.search ||
			root.hash ||
			/%(?:2f|5c|00)/i.test(root.pathname)
		)
			return null;
		const expected = new URL(root);
		expected.pathname =
			root.pathname.replace(/\/+$/, '') +
			'/' +
			checkpointKey('', 'history', input.checkpoint);
		return new URL(input.failedObjectUrl).href === expected.href ? root : null;
	} catch {
		return null;
	}
}

export const objectRootPrefix = (root: URL): string => {
	const path = decodeURIComponent(root.pathname)
		.replace(/^\//, '')
		.replace(/\/+$/, '');
	return path ? path + '/' : '';
};
