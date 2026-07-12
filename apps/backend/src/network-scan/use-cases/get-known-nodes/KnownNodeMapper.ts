import { Snapshot } from '@core/domain/Snapshot.js';
import type Node from '@network-scan/domain/node/Node.js';
import type { KnownNodeIdentity } from '@network-scan/domain/node/NodeRepository.js';
import type { KnownNodeDTO, KnownNodeListItemDTO } from './GetKnownNodesDTO.js';
import type { KnownNodeRecordScope } from '../known-network-scope/KnownNetworkScope.js';

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
		scope: current
			? nodeDto.isValidator
				? 'current-validator'
				: 'listener'
			: 'archived',
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
		scope: 'public-key-only',
		snapshotStartDate: null,
		snapshotEndDate: null,
		lastSeen: lastMeasurementAt,
		lastMeasurementAt
	};
}

export function toKnownNodeListItemDTO(
	knownNode: KnownNodeDTO
): KnownNodeListItemDTO {
	return knownNode;
}

export function getKnownNodeScope(
	knownNode: KnownNodeDTO
): KnownNodeRecordScope {
	return knownNode.scope;
}

function isCurrentSnapshot(snapshotEndDate: Date): boolean {
	return snapshotEndDate.getTime() === Snapshot.MAX_DATE.getTime();
}
