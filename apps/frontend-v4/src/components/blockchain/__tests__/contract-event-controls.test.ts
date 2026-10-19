import type { ExplorerFilters } from '../../../api/explorer-analytics';
import {
	applyEventControls,
	createEventControls
} from '../contract-event-controls';

describe('contract event controls', () => {
	it('initializes supported controls and falls back for unsupported values', () => {
		expect(
			createEventControls({
				type_code: '2',
				order: 'asc',
				limit: '50',
				topic: '  transfers  ',
				q: '  invoice  '
			})
		).toEqual({
			type: '2',
			order: 'asc',
			limit: '50',
			topic: 'transfers',
			q: 'invoice'
		});
		expect(
			createEventControls({ type_code: '9', order: 'sideways', limit: '500' })
		).toEqual({ type: 'all', order: 'desc', limit: '25', topic: '', q: '' });
	});

	it('applies controls and clears stale type, topic, and search filters', () => {
		const filters: ExplorerFilters = {
			type_code: '1',
			topic: 'old',
			q: 'old search',
			after: 'cursor',
			offset: '50',
			min_ledger: '10'
		};
		expect(
			applyEventControls(filters, {
				type: 'all',
				order: 'asc',
				limit: '10',
				topic: '  ',
				q: ''
			})
		).toEqual({ min_ledger: '10', order: 'asc', limit: '10' });
	});

	it('preserves unrelated window, hash, and outcome filters while dropping cursors', () => {
		const result = applyEventControls(
			{
				min_ledger: '100',
				max_ledger: '200',
				transaction_hash: 'abc',
				successful: 'false',
				after: 'cursor',
				offset: '25'
			},
			{ type: '0', order: 'desc', limit: '25', topic: '', q: '' }
		);
		expect(result).toEqual({
			min_ledger: '100',
			max_ledger: '200',
			transaction_hash: 'abc',
			successful: 'false',
			type_code: '0',
			order: 'desc',
			limit: '25'
		});
		expect(result).not.toHaveProperty('after');
		expect(result).not.toHaveProperty('offset');
	});
});
