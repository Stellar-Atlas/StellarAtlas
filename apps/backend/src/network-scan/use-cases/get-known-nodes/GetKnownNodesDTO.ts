import type { NodeV1 } from 'shared';

export type KnownNodeMetadataState = 'snapshot' | 'public_key_only';

export interface KnownNodeDTO {
	publicKey: string;
	dateDiscovered: string;
	node: NodeV1 | null;
	metadataState: KnownNodeMetadataState;
	current: boolean;
	snapshotStartDate: string | null;
	snapshotEndDate: string | null;
	lastSeen: string | null;
	lastMeasurementAt: string | null;
}

export interface KnownNodesDTO {
	generatedAt: string;
	count: number;
	nodes: KnownNodeDTO[];
}
