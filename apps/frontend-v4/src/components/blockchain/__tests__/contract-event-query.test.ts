import {
	contractEventExample,
	contractEventQueryError,
	contractEventWorkspaceHref
} from '../contract-event-query';
import { explorerRouteFilters } from '../../../api/explorer-search-route';
import { contractActivityPath } from '../../../api/explorer-contract-activity';
import type { ExplorerFilters } from '../../../api/explorer-analytics';

const invalidFilters: ExplorerFilters[] = [
	{ contract_id: 'bad' },
	{ min_ledger: '1.5' },
	{ max_ledger: '1' },
	{ max_ledger: '2147483648' },
	{ transaction_hash: 'xyz' },
	{ type_code: '3' },
	{ successful: 'maybe' },
	{ min_ledger: '1', max_ledger: '1000001' }
];

describe('contract event workspace query', () => {
	it('validates the imported example and preserves explicit failed outcomes', () => {
		const filters = {
			...contractEventExample,
			successful: 'false',
			in_successful_contract_call: 'false',
			type_code: '0'
		};
		expect(contractEventQueryError(filters)).toBeNull();
		const query = Object.fromEntries(
			new URL('https://stellaratlas.io' + contractEventWorkspaceHref(filters))
				.searchParams
		);
		expect(explorerRouteFilters(query)).toEqual(filters);
		const path = contractActivityPath(filters.contract_id!, 'events', filters);
		expect(path).toContain('successful=false');
		expect(path).toContain('type_code=0');
		expect(path).toContain('view=typed');
		expect(path).not.toContain('offset');
	});
	it.each(invalidFilters)(
		'rejects malformed or oversized queries: %j',
		(override) => {
			expect(
				contractEventQueryError({ ...contractEventExample, ...override })
			).not.toBeNull();
		}
	);
	it('accepts exactly the documented inclusive window', () => {
		expect(
			contractEventQueryError({
				...contractEventExample,
				min_ledger: '1',
				max_ledger: '1000000'
			})
		).toBeNull();
	});
});
