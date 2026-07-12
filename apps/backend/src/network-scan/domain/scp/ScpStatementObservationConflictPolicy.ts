import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';

export function selectDeterministicScpStatementObservations(
	observations: readonly CrawlerScpStatementObservation[]
): CrawlerScpStatementObservation[] {
	const selected = new Map<string, CrawlerScpStatementObservation>();
	for (const observation of observations) {
		const existing = selected.get(observation.statementHash);
		if (
			existing === undefined ||
			compareScpStatementObservationPreference(observation, existing) > 0
		) {
			selected.set(observation.statementHash, observation);
		}
	}

	return [...selected.values()].sort((left, right) =>
		left.statementHash.localeCompare(right.statementHash)
	);
}

export function batchScpStatementObservationsForUpsert(
	observations: readonly CrawlerScpStatementObservation[],
	batchSize: number
): CrawlerScpStatementObservation[][] {
	if (!Number.isInteger(batchSize) || batchSize <= 0) {
		throw new Error('SCP statement upsert batch size must be positive');
	}
	const batches: CrawlerScpStatementObservation[][] = [];
	const nextBatchByHash = new Map<string, number>();
	const ordered = [...observations].sort(
		(left, right) =>
			left.statementHash.localeCompare(right.statementHash) ||
			compareScpStatementObservationPreference(left, right)
	);

	for (const observation of ordered) {
		let batchIndex = nextBatchByHash.get(observation.statementHash) ?? 0;
		while (batches[batchIndex]?.length === batchSize) {
			batchIndex += 1;
		}
		batches[batchIndex] ??= [];
		batches[batchIndex].push(observation);
		nextBatchByHash.set(observation.statementHash, batchIndex + 1);
	}

	return batches;
}

export function compareScpStatementObservationPreference(
	left: CrawlerScpStatementObservation,
	right: CrawlerScpStatementObservation
): number {
	const timeComparison = compareNumber(
		left.observedAt.getTime(),
		right.observedAt.getTime()
	);
	if (timeComparison !== 0) return timeComparison;

	for (const [leftValue, rightValue] of [
		[left.observedFromPeer, right.observedFromPeer],
		[left.observedFromAddress, right.observedFromAddress],
		[left.nodeId, right.nodeId],
		[left.signature, right.signature]
	] as const) {
		const comparison = leftValue.localeCompare(rightValue);
		if (comparison !== 0) return comparison;
	}

	const slotComparison = compareBigInt(left.slotIndex, right.slotIndex);
	if (slotComparison !== 0) return slotComparison;

	for (const [leftValue, rightValue] of [
		[left.statementType, right.statementType],
		[left.statementXdr, right.statementXdr],
		[canonicalJson(left.pledges), canonicalJson(right.pledges)],
		[canonicalJson(left.values), canonicalJson(right.values)]
	] as const) {
		const comparison = leftValue.localeCompare(rightValue);
		if (comparison !== 0) return comparison;
	}

	return 0;
}

function compareNumber(left: number, right: number): number {
	return left === right ? 0 : left > right ? 1 : -1;
}

function compareBigInt(left: string, right: string): number {
	try {
		const leftValue = BigInt(left);
		const rightValue = BigInt(right);
		return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
	} catch {
		return left.localeCompare(right);
	}
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(',')}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
	return `{${entries.join(',')}}`;
}
