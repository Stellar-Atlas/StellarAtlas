'use client';

import type { ArchiveInventorySnapshot } from './archive-inventory-snapshot';

const requestTimeoutMs = 12_000;
const warmCooldownMs = 60_000;
let snapshot: ArchiveInventorySnapshot | null = null;
let inFlight: Promise<ArchiveInventorySnapshot> | null = null;
let lastWarmStartedAt = Number.NEGATIVE_INFINITY;

export function getCachedArchiveInventorySnapshot():
	| ArchiveInventorySnapshot
	| null {
	return snapshot;
}

export function rememberArchiveInventorySnapshot(
	incoming: ArchiveInventorySnapshot
): void {
	if (!isArchiveInventorySnapshot(incoming)) return;
	const incomingAt = Date.parse(incoming.summary.generatedAt);
	const currentAt = snapshot
		? Date.parse(snapshot.summary.generatedAt)
		: Number.NEGATIVE_INFINITY;
	if (Number.isFinite(incomingAt) && incomingAt >= currentAt) snapshot = incoming;
}

export function loadArchiveInventorySnapshot(): Promise<ArchiveInventorySnapshot> {
	if (inFlight !== null) return inFlight;
	const controller = new AbortController();
	const timeout = window.setTimeout(
		() => controller.abort(),
		requestTimeoutMs
	);
	inFlight = fetch('/api/archive-inventory', { signal: controller.signal })
		.then(async (response) => {
			if (!response.ok) throw new Error('Archive inventory request failed');
			const value: unknown = await response.json();
			if (!isArchiveInventorySnapshot(value))
				throw new Error('Archive inventory response is invalid');
			rememberArchiveInventorySnapshot(value);
			return value;
		})
		.finally(() => {
			window.clearTimeout(timeout);
			inFlight = null;
		});
	return inFlight;
}

export function prewarmArchiveInventorySnapshot(): void {
	if (
		typeof document === 'undefined' ||
		document.visibilityState === 'hidden' ||
		snapshot !== null ||
		inFlight !== null ||
		Date.now() - lastWarmStartedAt < warmCooldownMs
	)
		return;
	lastWarmStartedAt = Date.now();
	void loadArchiveInventorySnapshot().catch(() => {});
}

function isArchiveInventorySnapshot(
	value: unknown
): value is ArchiveInventorySnapshot {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Partial<ArchiveInventorySnapshot>;
	return (
		typeof candidate.summary === 'object' &&
		candidate.summary !== null &&
		typeof candidate.summary.generatedAt === 'string' &&
		candidate.summary.canonicalProofProgress !== undefined &&
		Array.isArray(candidate.summary.sources) &&
		Array.isArray(candidate.nodes) &&
		Array.isArray(candidate.organizations)
	);
}
