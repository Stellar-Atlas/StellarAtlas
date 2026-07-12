export function formatCanonicalEvidenceSelection(sourceCount: number): string {
	const label = sourceCount === 1 ? 'archive root' : 'archive roots';
	return `canonical evidence selected from ${sourceCount.toLocaleString()} verified ${label}`;
}
