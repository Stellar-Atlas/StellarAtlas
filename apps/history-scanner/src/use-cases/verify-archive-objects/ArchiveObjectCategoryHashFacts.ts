/** Stable ledger ordering for the existing category verification facts. */
export function mapHashFacts(
	hashes: ReadonlyMap<number, string>
): readonly { readonly hash: string; readonly ledger: number }[] {
	return Array.from(hashes.entries())
		.map(([ledger, hash]) => ({ hash, ledger }))
		.sort((left, right) => left.ledger - right.ledger);
}
