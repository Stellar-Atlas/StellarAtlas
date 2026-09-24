import { parseContractActivityPage } from '../../../api/explorer-contract-activity';
import {
	contractActivityReducer as reduce,
	initialContractActivityState,
	formatContractJson
} from '../explorer-contract-activity-model';
import { contractId, eventResponse } from './contract-activity-fixtures';
const first = parseContractActivityPage(
	eventResponse('opaque-next'),
	contractId,
	'events'
);
describe('contract activity cursor and failure state', () => {
	it('keeps the last loaded page on failed next-page requests and retries the exact cursor', () => {
		const loaded = reduce(initialContractActivityState, {
			type: 'loaded',
			requestId: 0,
			page: first
		});
		const loading = reduce(loaded, { type: 'next' });
		expect(loading).toMatchObject({
			page: first,
			pageIndex: 0,
			requestedIndex: 1,
			requestedPosition: 'opaque-next',
			loading: true
		});
		const failed = reduce(loading, {
			type: 'failed',
			requestId: loading.requestId,
			error: 'HTTP 503'
		});
		expect(failed).toMatchObject({
			page: first,
			pageIndex: 0,
			positions: [''],
			loading: false,
			error: 'HTTP 503'
		});
		const retry = reduce(failed, { type: 'retry' });
		expect(retry.requestedPosition).toBe('opaque-next');
		expect(retry.requestedIndex).toBe(1);
		expect(retry.requestId).toBe(loading.requestId + 1);
		expect(retry.page).toBe(first);
		const nextPage = { ...first, nextPosition: null };
		const recovered = reduce(retry, {
			type: 'loaded',
			requestId: retry.requestId,
			page: nextPage
		});
		expect(recovered.positions).toEqual(['', 'opaque-next']);
		expect(recovered.pageIndex).toBe(1);
		expect(reduce(recovered, { type: 'next' })).toBe(recovered);
		const previous = reduce(recovered, { type: 'previous' });
		expect(previous).toMatchObject({
			requestedPosition: '',
			requestedIndex: 0,
			page: nextPage
		});
	});
	it('ignores stale responses and keeps failed initial requests retryable', () => {
		const failed = reduce(initialContractActivityState, {
			type: 'failed',
			requestId: 0,
			error: 'Offline'
		});
		const retry = reduce(failed, { type: 'retry' });
		expect(retry.requestedPosition).toBe('');
		expect(reduce(retry, { type: 'loaded', requestId: 0, page: first })).toBe(
			retry
		);
		expect(reduce(retry, { type: 'failed', requestId: 0, error: 'old' })).toBe(
			retry
		);
	});
	it('refreshes the current loaded page rather than a failed future page', () => {
		const loaded = reduce(initialContractActivityState, {
			type: 'loaded',
			requestId: 0,
			page: first
		});
		const next = reduce(loaded, { type: 'next' });
		const failed = reduce(next, {
			type: 'failed',
			requestId: next.requestId,
			error: 'Unavailable'
		});
		expect(reduce(failed, { type: 'refresh' })).toMatchObject({
			requestedPosition: '',
			requestedIndex: 0,
			page: first
		});
	});
	it('formats structured JSON without rounding integers or changing strings', () => {
		const value =
			'{"amount":170141183460469231731687303715884105727,"topic":"a, {b} \\"c\\""}';
		const formatted = formatContractJson(value);
		expect(formatted).toContain('170141183460469231731687303715884105727');
		expect(formatted).toContain('"topic": "a, {b} \\"c\\""');
		expect(formatted).toContain('\n');
		expect(formatContractJson('not json')).toBe('not json');
		expect(JSON.parse(formatted)).toEqual(JSON.parse(value));
	});
});
