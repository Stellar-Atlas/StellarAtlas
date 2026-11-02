import { describe, expect, it } from '@jest/globals';
import { copyGraphqlQuery } from '../graphql-query-copy';

describe('GraphQL query clipboard feedback', () => {
	it('copies the complete edited query without formatting or dropping Unicode/newlines', async () => {
		const query = '# edited α\nquery Edited { fixture { value marker } }\n';
		const captured: string[] = [];
		expect(
			await copyGraphqlQuery(query, () => ({
				writeText: async (value) => {
					captured.push(value);
				}
			}))
		).toBe('Query copied.');
		expect(captured).toEqual([query]);
	});
	it('reports clipboard rejection without claiming success or throwing', async () => {
		const result = await copyGraphqlQuery(
			'query Edited { fixture { value } }',
			() => ({
				writeText: async () => {
					throw new Error('denied');
				}
			})
		);
		expect(result).toBe(
			'Could not copy the query. Select the query and copy it manually.'
		);
	});
	it('reports an unavailable clipboard with a manual-copy instruction', async () => {
		expect(
			await copyGraphqlQuery(
				'query Edited { fixture { value } }',
				() => undefined
			)
		).toBe(
			'Clipboard access is unavailable. Select the query and copy it manually.'
		);
	});
	it('handles a browser clipboard getter failure', async () => {
		expect(
			await copyGraphqlQuery('query Edited { fixture { value } }', () => {
				throw new Error('blocked getter');
			})
		).toContain('Could not copy');
	});
});
