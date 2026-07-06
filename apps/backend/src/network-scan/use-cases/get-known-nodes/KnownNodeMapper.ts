import { Snapshot } from '@core/domain/Snapshot.js';
import type Node from '@network-scan/domain/node/Node.js';
import type { KnownNodeIdentity } from '@network-scan/domain/node/NodeRepository.js';
import type { KnownNodeDTO } from './GetKnownNodesDTO.js';

export function toKnownNodeDTO(
	node: Node,
	nodeDto: NonNullable<KnownNodeDTO['node']>
): KnownNodeDTO {
	const current = isCurrentSnapshot(node.snapshotEndDate);
	const lastMeasurementAt =
		node.latestMeasurement()?.time.toISOString() ?? null;
	const snapshotEndDate = node.snapshotEndDate.toISOString();

	return {
		publicKey: node.publicKey.value,
		dateDiscovered: node.dateDiscovered.toISOString(),
		node: nodeDto,
		metadataState: 'snapshot',
		current,
		snapshotStartDate: node.snapshotStartDate.toISOString(),
		snapshotEndDate: current ? null : snapshotEndDate,
		lastSeen: lastMeasurementAt ?? (current ? null : snapshotEndDate),
		lastMeasurementAt
	};
}

export function toPublicKeyOnlyKnownNodeDTO(
	identity: KnownNodeIdentity
): KnownNodeDTO {
	const lastMeasurementAt = identity.lastMeasurementAt?.toISOString() ?? null;

	return {
		publicKey: identity.publicKey,
		dateDiscovered: identity.dateDiscovered.toISOString(),
		node: null,
		metadataState: 'public_key_only',
		current: false,
		snapshotStartDate: null,
		snapshotEndDate: null,
		lastSeen: lastMeasurementAt,
		lastMeasurementAt
	};
}

function isCurrentSnapshot(snapshotEndDate: Date): boolean {
	return snapshotEndDate.getTime() === Snapshot.MAX_DATE.getTime();
}
