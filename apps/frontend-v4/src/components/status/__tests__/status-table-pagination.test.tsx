/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	getStatusTablePage,
	StatusTablePagination
} from '../status-table-pagination';

describe('status table pagination', () => {
	it('bounds an oversized page without dropping the final rows', () => {
		const rows = Array.from({ length: 23 }, (_, index) => index);
		const page = getStatusTablePage(rows, 99, 8);

		expect(page.page).toBe(2);
		expect(page.pageCount).toBe(3);
		expect(page.rows).toEqual([16, 17, 18, 19, 20, 21, 22]);
	});

	it('renders an accessible bounded range', () => {
		const html = renderToStaticMarkup(
			createElement(StatusTablePagination, {
				label: 'Archive worker pages',
				onPageChange: () => undefined,
				page: 0,
				pageSize: 8,
				totalRows: 24
			})
		);

		expect(html).toContain('aria-label="Archive worker pages"');
		expect(html).toContain('1-8 of 24');
		expect(html).toContain('disabled=""');
	});
});
