/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicCanonicalExplorerOperation } from '@api/types';
import { ExplorerOperationTable } from '../explorer-operation-table';

describe('explorer operation outcomes', () => {
	it('renders a transaction result XDR outcome without claiming effects', () => {
		const html = renderToStaticMarkup(
			<ExplorerOperationTable operations={[canonicalOperation()]} />
		);

		expect(html).toContain('Succeeded');
		expect(html).toContain('Transaction result XDR');
		expect(html).toContain('result code 0');
		expect(html).not.toContain('effects');
		expect(html).not.toContain('state changes');
	});

	it('labels an uncovered operation outcome as not indexed', () => {
		const html = renderToStaticMarkup(
			<ExplorerOperationTable
				operations={[
					{
						...canonicalOperation(),
						operationResultCode: null,
						operationSpecificResultCode: null,
						outcome: null,
						outcomeAvailable: false,
						outcomeEvidence: null
					}
				]}
			/>
		);

		expect(html).toContain('Not indexed');
		expect(html).toContain(
			'Transaction result XDR has not been indexed for this batch'
		);
	});
});

function canonicalOperation(): PublicCanonicalExplorerOperation {
	return {
		createdAt: '2026-07-12T12:00:00.000Z',
		evidence: {
			archiveSource: 'archive.example',
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointLedger: '63386303',
			checkpointProofId: 41,
			decoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts',
			proofEvaluatedAt: '2026-07-12T12:01:00.000Z',
			proofVersion: 5
		},
		factScope: 'operation_body_and_envelope',
		id: `${'ab'.repeat(32)}:0`,
		ledger: '63386303',
		operationIndex: 0,
		operationResultCode: 0,
		operationSpecificResultCode: 0,
		outcome: 'succeeded',
		outcomeAvailable: true,
		outcomeEvidence: {
			decoderVersion:
				'stellar-sdk-16/transaction-result-xdr-v1-operation-results',
			factScope: 'transaction_result_xdr'
		},
		source: 'postgres_canonical',
		sourceAccount: `G${'A'.repeat(55)}`,
		sourceAccountOrigin: 'transaction',
		transactionHash: 'ab'.repeat(32),
		transactionIndex: 0,
		type: 'payment'
	};
}
