import type {
	ScpStatementLiveCursor,
	ScpStatementLiveOrder
} from '../../domain/scp/ScpStatementLiveStore.js';

export type ScpStatementSource = 'auto' | 'live' | 'stored';

export interface GetScpStatementsDTO {
	after?: ScpStatementLiveCursor;
	limit?: number;
	nodeId?: string;
	order?: ScpStatementLiveOrder;
	source?: ScpStatementSource;
	slotIndex?: string;
}

export interface GetStoredScpStatementPageDTO {
	after?: ScpStatementLiveCursor;
	limit?: number;
	nodeId?: string;
	nodeIds?: readonly string[];
	order?: ScpStatementLiveOrder;
	slotIndex?: string;
}
