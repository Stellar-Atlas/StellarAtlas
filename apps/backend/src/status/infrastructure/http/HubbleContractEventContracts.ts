import type { HubbleTransactionEvent } from './HubbleTransactionContracts.js';
import type { HubbleTransferWatermark } from './HubbleTransferContracts.js';
import type { HubbleLedgerCoverage } from './HubbleLedgerCoverage.js';

export interface HubbleContractEventInput {
	readonly contractId: string;
	readonly transactionHash?: string;
	readonly minLedger?: number;
	readonly maxLedger?: number;
	readonly startTime?: string;
	readonly endTime?: string;
	readonly typeCode?: number;
	readonly successful?: boolean;
	readonly inSuccessfulContractCall?: boolean;
	readonly limit?: number;
	readonly after?: string;
}
export interface HubbleContractEventPage {
	readonly contractId: string;
	readonly items: readonly HubbleTransactionEvent[];
	readonly limit: number;
	readonly nextCursor: string | null;
	readonly watermark: HubbleTransferWatermark;
	readonly coverage: HubbleLedgerCoverage;
	readonly elapsedMilliseconds: number;
}
