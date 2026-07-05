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
