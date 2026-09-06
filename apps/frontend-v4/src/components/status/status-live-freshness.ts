export function selectArchiveEvidence<
	T extends { readonly generatedAt: string }
>(
	current: T,
	currentAvailable: boolean,
	incoming: T | undefined
): { readonly summary: T; readonly available: boolean } {
	if (
		incoming === undefined ||
		!Number.isFinite(Date.parse(incoming.generatedAt))
	) {
		return { summary: current, available: currentAvailable };
	}
	const currentTime = Date.parse(current.generatedAt);
	if (
		!currentAvailable ||
		!Number.isFinite(currentTime) ||
		Date.parse(incoming.generatedAt) >= currentTime
	) {
		return { summary: incoming, available: true };
	}
	return { summary: current, available: currentAvailable };
}

export function statusUpdatesAreStale(
	lastReceivedAt: number,
	now: number
): boolean {
	return now - lastReceivedAt >= 15_000;
}
