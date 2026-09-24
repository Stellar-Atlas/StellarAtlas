import type { EntityRecord } from '../../../api/explorer-analytics';
export const contractId =
	'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
export const event: EntityRecord = {
	id: '63490364:0:batch:digest',
	contractId,
	transactionId: '272688820134985728',
	transactionHash: 'abc123',
	operationId: null,
	ledgerSequence: 63490364,
	closedAt: '2026-01-01T00:00:00Z',
	type: 'contract',
	typeCode: 1,
	successful: true,
	inSuccessfulContractCall: true,
	topicsJson: '["transfer",{"address":"GEXAMPLE"}]',
	dataJson: '{"amount":170141183460469231731687303715884105727}',
	eventXdr: 'AAAA',
	classification: {
		transactionKind: 'soroban',
		eventKind: 'contract',
		sorobanExecutionEvidence: true,
		provenance: 'complete'
	}
};
export function eventResponse(nextCursor: string | null = null) {
	return {
		contractId,
		items: [event],
		limit: 10,
		nextCursor,
		watermark: {
			minimumLedger: 63490364,
			maximumLedger: 63490365,
			coverage: 'ingested-only',
			observedAt: '2026-01-01T01:00:00Z'
		},
		coverage: {
			contiguousFirstLedger: '2',
			contiguousLastLedger: '41186000',
			gapCount: 1
		}
	};
}
