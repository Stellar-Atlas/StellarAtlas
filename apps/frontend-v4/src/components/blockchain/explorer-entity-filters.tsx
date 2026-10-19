'use client';

import { useEffect, useState } from 'react';
import { localTimeInput } from '../../api/explorer-search-route';
import type {
	AnalyticsCollection,
	ExplorerFilters
} from '../../api/explorer-analytics';
import { stellarOperationTypes } from '../../domain/stellar-operation-types';
import {
	entityFields,
	windowFields,
	type EntityField
} from './explorer-entity-config';
import styles from './explorer-entity.module.css';

export function withoutExplorerWindow(
	filters: ExplorerFilters
): ExplorerFilters {
	return Object.fromEntries(
		Object.entries(filters).filter(
			([key]) => !windowFields.some((field) => field.key === key)
		)
	);
}

export function ExplorerEntityFilters({
	collection,
	identifier,
	filters,
	busy,
	onChange,
	onApply
}: {
	readonly collection: AnalyticsCollection;
	readonly identifier?: string;
	readonly filters: ExplorerFilters;
	readonly busy: boolean;
	readonly onChange: (filters: ExplorerFilters) => void;
	readonly onApply: (filters: ExplorerFilters) => void;
}): React.JSX.Element {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const primary = identifier ? [] : entityFields[collection];
	const rangeCount = windowFields.filter((field) =>
		filters[field.key]?.trim()
	).length;
	const field = ({ key, label, type, placeholder }: EntityField) => (
		<label key={key}>
			{label}
			{key === 'type' && collection === 'operations' ? (
				<select
					value={filters[key] ?? ''}
					onChange={(event) =>
						onChange({ ...filters, [key]: event.currentTarget.value })
					}
				>
					{filters[key] &&
						!stellarOperationTypes.some((value) => value === filters[key]) && (
							<option value={filters[key]}>{filters[key]}</option>
						)}
					{stellarOperationTypes.map((value) => (
						<option key={value} value={value}>
							{value ? value.replaceAll('_', ' ') : 'All operation types'}
						</option>
					))}
				</select>
			) : (
				<input
					type={type ?? 'text'}
					placeholder={placeholder}
					value={
						type === 'datetime-local'
							? mounted
								? localTimeInput(filters[key] ?? '')
								: ''
							: (filters[key] ?? '')
					}
					onChange={(event) =>
						onChange({ ...filters, [key]: event.currentTarget.value })
					}
				/>
			)}
		</label>
	);
	return (
		<form
			className={styles.filterForm}
			onSubmit={(event) => {
				event.preventDefault();
				onApply(filters);
			}}
		>
			{primary.length > 0 && (
				<div className={styles.form}>{primary.map(field)}</div>
			)}
			<details className={styles.rangeFilters}>
				<summary>
					Date &amp; ledger range
					{rangeCount > 0 && <span>{rangeCount} set</span>}
				</summary>
				<div className={styles.form}>{windowFields.map(field)}</div>
				<button
					type="button"
					className={styles.textAction}
					onClick={() => onChange(withoutExplorerWindow(filters))}
				>
					Clear range
				</button>
			</details>
			<div className={styles.filterToolbar}>
				<div className={styles.actions}>
					<button type="submit" disabled={busy}>
						{busy ? 'Loading…' : 'Apply filters'}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							const next = withoutExplorerWindow(filters);
							onChange(next);
							onApply(next);
						}}
					>
						Latest published
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							const next: ExplorerFilters = filters.limit
								? { limit: filters.limit }
								: {};
							onChange(next);
							onApply(next);
						}}
					>
						Clear filters
					</button>
				</div>
				{!identifier && (
					<label className={styles.pageSize}>
						Rows per page
						<select
							value={filters.limit ?? '25'}
							onChange={(event) =>
								onChange({ ...filters, limit: event.currentTarget.value })
							}
						>
							{filters.limit &&
								!['10', '25', '50', '100'].includes(filters.limit) && (
									<option value={filters.limit}>{filters.limit}</option>
								)}
							{[10, 25, 50, 100].map((size) => (
								<option key={size} value={size}>
									{size}
								</option>
							))}
						</select>
					</label>
				)}
			</div>
		</form>
	);
}
