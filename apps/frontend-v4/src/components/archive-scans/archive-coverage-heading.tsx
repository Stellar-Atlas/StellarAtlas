import type { ArchiveInventorySort } from './archive-inventory-model';

export function ArchiveCoverageHeading({
	value,
	onChange
}: {
	readonly value: ArchiveInventorySort;
	readonly onChange: (value: ArchiveInventorySort) => void;
}): React.JSX.Element {
	const active =
		value.startsWith('scan-coverage') || value.startsWith('coverage-');
	const direction = active
		? value.endsWith('-asc')
			? 'ascending'
			: 'descending'
		: 'none';
	return (
		<th role="columnheader" scope="col" aria-sort={direction}>
			{(['coverage', 'scan-coverage'] as const).map((mode) => {
				const selected = value.startsWith(mode + '-');
				const ascending = selected && value.endsWith('-asc');
				const next = (
					ascending ? mode + '-desc' : selected ? mode + '-asc' : mode + '-desc'
				) as ArchiveInventorySort;
				const label = mode === 'coverage' ? 'Verified' : 'Scanned';
				return (
					<button
						key={mode}
						type="button"
						className="archive-sort-heading"
						onClick={() => onChange(next)}
						title={
							'Sort ' +
							label.toLowerCase() +
							' coverage ' +
							(next.endsWith('-asc') ? 'ascending' : 'descending')
						}
					>
						{label}
						<span aria-hidden="true">
							{selected ? (ascending ? '↑' : '↓') : '↕'}
						</span>
					</button>
				);
			})}
		</th>
	);
}
