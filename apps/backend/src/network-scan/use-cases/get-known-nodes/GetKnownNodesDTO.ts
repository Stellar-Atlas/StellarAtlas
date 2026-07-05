import type { NodeV1 } from 'shared';

export interface KnownNodeDTO {
	node: NodeV1;
	current: boolean;
	snapshotStartDate: string;
	snapshotEndDate: string;
	lastSeen: string | null;
	lastMeasurementAt: string | null;
}

export interface KnownNodesDTO {
	generatedAt: string;
	count: number;
	nodes: KnownNodeDTO[];
}
