import type { NodeV1 } from 'shared';
import type {
	KnownNetworkPageDTO,
	KnownNodeRecordScope,
	KnownNodeScope
} from '../known-network-scope/KnownNetworkScope.js';

export type KnownNodeMetadataState = 'snapshot' | 'public_key_only';

export interface KnownNodeDTO {
	publicKey: string;
	readonly scope: KnownNodeRecordScope;
	dateDiscovered: string;
	node: NodeV1 | null;
	metadataState: KnownNodeMetadataState;
	current: boolean;
	snapshotStartDate: string | null;
	snapshotEndDate: string | null;
	lastSeen: string | null;
	lastMeasurementAt: string | null;
}

export type KnownNodeListItemDTO = KnownNodeDTO;

export type KnownNodeScopeTotals = Record<KnownNodeScope, number>;

export interface KnownNodesInventoryDTO {
	generatedAt: string;
	count: number;
	nodes: KnownNodeListItemDTO[];
	scopeTotals: KnownNodeScopeTotals;
	source: 'postgres_canonical';
}

export interface KnownNodesDTO extends KnownNodesInventoryDTO {
	page: KnownNetworkPageDTO;
	scope: KnownNodeScope;
}
