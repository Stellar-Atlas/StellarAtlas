'use client';

import { formatInteger } from '@format/formatters';

export interface StatusTablePage<T> {
	readonly page: number;
	readonly pageCount: number;
	readonly rows: readonly T[];
}

export function getStatusTablePage<T>(
	rows: readonly T[],
	page: number,
	pageSize: number
): StatusTablePage<T> {
	const boundedPageSize = Math.max(1, Math.floor(pageSize));
	const pageCount = Math.max(1, Math.ceil(rows.length / boundedPageSize));
	const boundedPage = Math.max(0, Math.min(Math.floor(page), pageCount - 1));
	const start = boundedPage * boundedPageSize;

	return {
		page: boundedPage,
		pageCount,
		rows: rows.slice(start, start + boundedPageSize)
	};
}

export function StatusTablePagination({
	label,
	onPageChange,
	page,
	pageSize,
	totalRows
}: {
	readonly label: string;
	readonly onPageChange: (page: number) => void;
	readonly page: number;
	readonly pageSize: number;
	readonly totalRows: number;
}): React.JSX.Element | null {
	if (totalRows <= pageSize) return null;
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
	const first = page * pageSize + 1;
	const last = Math.min(totalRows, (page + 1) * pageSize);

	return (
		<nav aria-label={label} className="table-pagination">
			<button
				disabled={page === 0}
				onClick={() => onPageChange(page - 1)}
				type="button"
			>
				Previous
			</button>
			<span>
				{formatInteger(first)}-{formatInteger(last)} of{' '}
				{formatInteger(totalRows)}
			</span>
			<button
				disabled={page >= pageCount - 1}
				onClick={() => onPageChange(page + 1)}
				type="button"
			>
				Next
			</button>
		</nav>
	);
}
