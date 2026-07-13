export function formatCanonicalEvidenceSelection(sourceCount: number): string {
	const label = sourceCount === 1 ? 'archive root' : 'archive roots';
	return `${sourceCount.toLocaleString()} verified ${label} contributed to this canonical range`;
}
