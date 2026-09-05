import type { ArchiveInventorySnapshot } from '@api/archive-inventory-snapshot';
import { ArchiveRootInventory } from './archive-root-inventory';

export function ArchiveInventoryView({
	snapshot
}: {
	readonly snapshot: ArchiveInventorySnapshot;
}): React.JSX.Element {
	return (
		<ArchiveRootInventory
			summary={snapshot.summary}
			nodes={snapshot.nodes}
			organizations={snapshot.organizations}
		/>
	);
}
