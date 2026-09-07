import { formatInteger } from '@format/formatters';
import { formatCoveragePercent } from './archive-inventory-model';
import type { ArchiveOrganizationGroup } from './archive-organization-groups';

export function ArchiveOrganizationGroupHeading({
	group,
	id
}: {
	readonly group: ArchiveOrganizationGroup;
	readonly id: string;
}): React.JSX.Element {
	return (
		<tr role="row" className="archive-organization-heading">
			<th
				role="rowheader"
				scope="rowgroup"
				colSpan={4}
				id={id}
				style={{
					gridColumn: '1 / -1',
					width: 'auto',
					textAlign: 'left',
					textTransform: 'none',
					padding: '14px 16px'
				}}
			>
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						alignItems: 'baseline',
						justifyContent: 'space-between',
						gap: '6px 24px'
					}}
				>
					<div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
						<strong className="archive-organization-name">{group.name}</strong>
						<small>
							{formatInteger(group.sources.length)} distinct{' '}
							{group.sources.length === 1 ? 'root' : 'roots'}
							{group.shared ? ' · shared roots listed once' : ''}
						</small>
					</div>
					<div>
						<strong>
							{group.verifiedPercent === null
								? 'Verified coverage unknown'
								: formatCoveragePercent(group.verifiedPercent) + ' verified'}
						</strong>
						<small>
							{formatInteger(group.verifiedPositions)} /{' '}
							{group.verifiedPercent === null
								? 'unknown expected'
								: formatInteger(group.expectedPositions)}{' '}
							root-checkpoint positions
						</small>
					</div>
				</div>
			</th>
		</tr>
	);
}
