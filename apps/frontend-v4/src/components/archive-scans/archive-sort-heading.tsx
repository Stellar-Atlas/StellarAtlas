import type { ArchiveInventorySort } from './archive-inventory-model';

export function ArchiveSortHeading({
	label,
	ascending,
	descending,
	initial,
	value,
	onChange
}: {
	readonly label: string;
	readonly ascending: ArchiveInventorySort;
	readonly descending: ArchiveInventorySort;
	readonly initial: 'ascending' | 'descending';
	readonly value: ArchiveInventorySort;
	readonly onChange: (value: ArchiveInventorySort) => void;
}): React.JSX.Element {
	const direction =
		value === ascending
			? 'ascending'
			: value === descending
				? 'descending'
				: 'none';
	const next =
		direction === 'ascending'
			? descending
			: direction === 'descending'
				? ascending
				: initial === 'ascending'
					? ascending
					: descending;
	return (
		<th role="columnheader" scope="col" aria-sort={direction}>
			<button
				type="button"
				className="archive-sort-heading"
				onClick={() => onChange(next)}
				title={
					'Sort ' +
					label.toLowerCase() +
					(next === ascending ? ' ascending' : ' descending')
				}
			>
				{label}
				<span aria-hidden="true">
					{direction === 'ascending'
						? '↑'
						: direction === 'descending'
							? '↓'
							: '↕'}
				</span>
			</button>
		</th>
	);
}
