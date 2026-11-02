interface ExampleClipboard {
	readonly writeText?: (source: string) => Promise<void>;
}
export type CopyExampleResult = 'copied' | 'failed' | 'unavailable';

export async function copyExampleSource(
	source: string,
	getClipboard: () => ExampleClipboard | undefined = () =>
		typeof navigator === 'undefined' ? undefined : navigator.clipboard
): Promise<CopyExampleResult> {
	try {
		const clipboard = getClipboard();
		if (typeof clipboard?.writeText !== 'function') return 'unavailable';
		await clipboard.writeText(source);
		return 'copied';
	} catch {
		return 'failed';
	}
}
