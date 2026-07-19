import type {
	PublicHistoryArchiveObjectType,
	PublicKnownArchiveRootEvidence
} from '@api/archive-evidence-types';
import {
	archiveObjectTypes,
	formatArchiveObjectType,
	formatArchiveRoot
} from '@domain/known-archive-evidence';
import { formatInteger } from '@format/formatters';

interface EvidenceFiltersProps {
	readonly archiveUrl: string | null;
	readonly disabled: boolean;
	readonly objectType: PublicHistoryArchiveObjectType | null;
	readonly onArchiveUrlChange: (value: string | null) => void;
	readonly onObjectTypeChange: (
		value: PublicHistoryArchiveObjectType | null
	) => void;
	readonly roots: readonly PublicKnownArchiveRootEvidence[];
}

export function EvidenceFilters({
	archiveUrl,
	disabled,
	objectType,
	onArchiveUrlChange,
	onObjectTypeChange,
	roots
}: EvidenceFiltersProps): React.JSX.Element {
	return (
		<div className="known-evidence-filters">
			<ArchiveSourceFilter
				disabled={disabled}
				onChange={onArchiveUrlChange}
				roots={roots}
				value={archiveUrl}
			/>
			<label>
				<span>File type</span>
				<select
					disabled={disabled}
					onChange={(event) => {
						const selected = archiveObjectTypes.find(
							(candidate) => candidate === event.target.value
						);
						onObjectTypeChange(selected ?? null);
					}}
					value={objectType ?? ''}
				>
					<option value="">All file types</option>
					{archiveObjectTypes.map((value) => (
						<option key={value} value={value}>
							{formatArchiveObjectType(value)}
						</option>
					))}
				</select>
			</label>
		</div>
	);
}

export function ArchiveSourceFilter({
	disabled,
	emptyLabel = 'All sources',
	onChange,
	roots,
	value
}: {
	readonly disabled: boolean;
	readonly emptyLabel?: string;
	readonly onChange: (value: string | null) => void;
	readonly roots: readonly PublicKnownArchiveRootEvidence[];
	readonly value: string | null;
}): React.JSX.Element {
	return (
		<label>
			<span>Archive source</span>
			<select
				disabled={disabled}
				onChange={(event) => onChange(event.target.value || null)}
				value={value ?? ''}
			>
				<option value="">{emptyLabel}</option>
				{roots.map((root) => (
					<option key={root.archiveUrlIdentity} value={root.archiveUrl}>
						{formatArchiveRoot(root.archiveUrl)}
					</option>
				))}
			</select>
		</label>
	);
}

export function CursorPagination({
	count,
	disabled,
	hasMore,
	index,
	limit,
	onNext,
	onPrevious,
	total
}: {
	readonly count: number;
	readonly disabled: boolean;
	readonly hasMore: boolean;
	readonly index: number;
	readonly limit: number;
	readonly onNext: () => void;
	readonly onPrevious: () => void;
	readonly total: number;
}): React.JSX.Element {
	const first = count === 0 ? 0 : index * limit + 1;
	const last = count === 0 ? 0 : first + count - 1;
	return (
		<div className="pagination-bar known-evidence-pagination">
			<span>
				{formatInteger(first)}-{formatInteger(last)} of {formatInteger(total)}
			</span>
			<button
				disabled={disabled || index === 0}
				onClick={onPrevious}
				type="button"
			>
				Previous
			</button>
			<button disabled={disabled || !hasMore} onClick={onNext} type="button">
				Next
			</button>
		</div>
	);
}
