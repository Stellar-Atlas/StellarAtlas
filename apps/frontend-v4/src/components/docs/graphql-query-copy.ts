import { copyExampleSource } from './copy-example-source';

export async function copyGraphqlQuery(
	query: string,
	getClipboard?: Parameters<typeof copyExampleSource>[1]
): Promise<string> {
	const result = await copyExampleSource(query, getClipboard);
	if (result === 'copied') return 'Query copied.';
	if (result === 'unavailable')
		return 'Clipboard access is unavailable. Select the query and copy it manually.';
	return 'Could not copy the query. Select the query and copy it manually.';
}
