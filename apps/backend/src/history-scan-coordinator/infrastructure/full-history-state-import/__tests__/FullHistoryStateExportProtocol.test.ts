import {
	FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES,
	FullHistoryStateExportSession,
	parseFullHistoryStateExportLine
} from '../FullHistoryStateExportProtocol.js';

const version = 'stellar-atlas.full-history-state-export.v1';

describe('FullHistoryStateExportProtocol', () => {
	it('streams a lossless account projection and checks the completion count', () => {
		const session = new FullHistoryStateExportSession('account-state-changes');
		expect(
			session.acceptLine(
				JSON.stringify({
					dataset: 'account-state-changes',
					type: 'header',
					version
				})
			)
		).toBeNull();
		const row = session.acceptLine(
			JSON.stringify({
				dataset: 'account-state-changes',
				type: 'row',
				value: accountValue()
			})
		);
		expect(row).toMatchObject({
			accountId: 'GACCOUNT',
			balance: '9223372036854775807',
			operationIndex: '1',
			sequenceLedger: null,
			signerSponsors: []
		});
		expect(
			session.acceptLine(
				JSON.stringify({
					dataset: 'account-state-changes',
					recordCount: '1',
					type: 'complete'
				})
			)
		).toBeNull();
		expect(session.finish()).toBe(1n);
	});

	it('parses credit trustline identity without losing bigint precision', () => {
		const event = parseFullHistoryStateExportLine(
			JSON.stringify({
				dataset: 'trustline-state-changes',
				type: 'row',
				value: trustlineValue()
			}),
			'trustline-state-changes'
		);
		expect(event).toMatchObject({
			type: 'row',
			value: {
				assetCode: 'USD',
				assetIssuer: 'GISSUER',
				balance: '-9223372036854775808',
				liquidityPoolId: ''
			}
		});
	});

	it('rejects count drift, schema drift, and incomplete streams', () => {
		const session = new FullHistoryStateExportSession('account-state-changes');
		session.acceptLine(
			JSON.stringify({
				dataset: 'account-state-changes',
				type: 'header',
				version
			})
		);
		expect(() =>
			session.acceptLine(
				JSON.stringify({
					dataset: 'account-state-changes',
					recordCount: '1',
					type: 'complete'
				})
			)
		).toThrow('completion count');
		expect(() => session.finish()).toThrow('closed before');
		expect(() =>
			parseFullHistoryStateExportLine(
				JSON.stringify({
					dataset: 'account-state-changes',
					extra: true,
					type: 'header',
					version
				}),
				'account-state-changes'
			)
		).toThrow('unexpected field set');
	});

	it('rejects oversized lines and incoherent signer arrays', () => {
		expect(() =>
			parseFullHistoryStateExportLine(
				'x'.repeat(FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES + 1),
				'account-state-changes'
			)
		).toThrow('invalid NDJSON line');
		expect(() =>
			parseFullHistoryStateExportLine(
				JSON.stringify({
					dataset: 'account-state-changes',
					type: 'row',
					value: {
						...accountValue(),
						signerCount: '1'
					}
				}),
				'account-state-changes'
			)
		).toThrow('signer arrays');
	});
});

function commonValue() {
	return {
		changeIndex: '1',
		changeType: 1,
		changeTypeString: 'LEDGER_ENTRY_CREATED',
		closedAtUnixMillis: '1720000000000',
		deleted: false,
		lastModifiedLedger: '1',
		ledgerKeySha256: 'a'.repeat(64),
		ledgerSequence: '1',
		operationIndex: '1',
		reason: 'operation',
		sponsor: null,
		stateEntryXdrBase64: Buffer.from([1, 2, 3]).toString('base64'),
		transactionHash: 'b'.repeat(64),
		transactionIndex: '1',
		upgradeIndex: null
	};
}

function accountValue() {
	return {
		...commonValue(),
		accountId: 'GACCOUNT',
		balance: '9223372036854775807',
		buyingLiabilities: '0',
		flags: '0',
		highThreshold: 3,
		homeDomain: '',
		inflationDestination: null,
		lowThreshold: 1,
		masterWeight: 1,
		mediumThreshold: 2,
		sequenceLedger: null,
		sequenceNumber: '1',
		sequenceTime: null,
		signerCount: '0',
		signerKeys: [],
		signerSponsors: [],
		signerWeights: [],
		sellingLiabilities: '0',
		sponsoredEntryCount: '0',
		sponsoringEntryCount: '0',
		subentryCount: '0'
	};
}

function trustlineValue() {
	return {
		...commonValue(),
		accountId: 'GACCOUNT',
		assetCode: 'USD',
		assetIssuer: 'GISSUER',
		assetType: 1,
		assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM4',
		balance: '-9223372036854775808',
		buyingLiabilities: '0',
		flags: '1',
		limit: '9223372036854775807',
		liquidityPoolId: '',
		liquidityPoolUseCount: 0,
		sellingLiabilities: '0'
	};
}
