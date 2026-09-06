// Recorded from published single-ledger detail responses at ledger 63490364.
// These are historical record examples, not current coverage or current-state claims.
export const explorerRecordExamples = {
	operation: {
		details: {
			parameters: [
				{
					type: 'Address',
					value: 'AAAAEgAAAAHX/kS9CvEdYCsQkfL0ofTfIS1ETQMh6jKts8wcu6sKBA=='
				},
				{ type: 'Sym', value: 'AAAADwAAAAVwbGFudAAAAA==' },
				{
					value: 'AAAAEgAAAAAAAAAAr/W5mEs7wV0vbMeXsLKcJwTOPbx4NWbrlZJtx4H5nAE=',
					type: 'Address'
				},
				{ type: 'I128', value: 'AAAACgAAAAAAAAAAAAAAAAAAAAA=' }
			],
			parameters_decoded: [
				{
					type: 'Address',
					value: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA'
				},
				{ type: 'Sym', value: 'plant' },
				{
					type: 'Address',
					value: 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ'
				},
				{ type: 'I128', value: '0' }
			],
			function: 'HostFunctionTypeHostFunctionTypeInvokeContract',
			parameters_json: [
				'AAAAEgAAAAHX/kS9CvEdYCsQkfL0ofTfIS1ETQMh6jKts8wcu6sKBA==',
				'AAAADwAAAAVwbGFudAAAAA==',
				'AAAAEgAAAAAAAAAAr/W5mEs7wV0vbMeXsLKcJwTOPbx4NWbrlZJtx4H5nAE=',
				'AAAACgAAAAAAAAAAAAAAAAAAAAA='
			],
			parameters_json_decoded: [
				{ address: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA' },
				{ symbol: 'plant' },
				{ address: 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ' },
				{ i128: '0' }
			],
			type: 'invoke_contract',
			asset_balance_changes: [],
			ledger_key_hash: [
				'ab6d011fbe26c36d7a2bfda00feddeefe23777563b426945ca3b6a5b8e368385',
				'cb6638600a2f7a9d34cc365cc325e7a2f8c2eb3d3057dcc3745c5870d64b3bd6',
				'1ed1058e76ba6492bb686b40c6476b495c2b06aeec770cf81b57306ec82c17e7',
				'3b1c752d97f13c2d390cc371b7f6935b951bb33b368d3d9e1f9dbe6375b1110a'
			],
			contract_code_hash: null,
			contract_id: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA'
		},
		ledgerSequence: 63490364,
		closedAt: '2026-07-15T16:43:50.000Z',
		sourceRecord: {
			batchId: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
			digest:
				'78dadc18671e087b3e9169c34601c932d5215aafc1d14ae7ec81e9bf0ddc2426',
			rowNumber: '128947'
		},
		id: '272689036992143361',
		transactionId: '272689036992143360',
		sourceAccount: 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ',
		type: 'invoke_host_function',
		typeCode: 24,
		transactionHash:
			'446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485'
	},
	trade: {
		ledgerSequence: 63490364,
		closedAt: '2026-07-15T16:43:50.000Z',
		sourceRecord: {
			batchId: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
			digest:
				'78dadc18671e087b3e9169c34601c932d5215aafc1d14ae7ec81e9bf0ddc2426',
			rowNumber: '13056'
		},
		sellingAsset: {
			id: 'F8:GBGRBCUB6L7LH4JQ6EPDP7REH2DDACMCUQI76M3P6DM52QWU2Z5LIEVW',
			type: 'credit_alphanum4',
			code: 'F8',
			issuer: 'GBGRBCUB6L7LH4JQ6EPDP7REH2DDACMCUQI76M3P6DM52QWU2Z5LIEVW'
		},
		buyingAsset: {
			id: '224:GBN42AP5SK3IPTEJ2KAY7DLCAH6YQSMI3H6CCZLWW7KIJCYJ3X57JZ6R',
			type: 'credit_alphanum4',
			code: '224',
			issuer: 'GBN42AP5SK3IPTEJ2KAY7DLCAH6YQSMI3H6CCZLWW7KIJCYJ3X57JZ6R'
		},
		amountPrecision: 'source_float64',
		id: '272689036991197185:0',
		operationId: '272689036991197185',
		order: 0,
		seller: null,
		buyer: 'GAFB7IYPCYZCODQBB5BR5JO45JC4PPVLARUAXQSFHWTLH2KMHPWJ36GD',
		sellingAmount: '0.0009571',
		buyingAmount: '0.0488962',
		price: {
			numerator: '488962',
			denominator: '9571'
		}
	},
	offer: {
		ledgerSequence: 63490364,
		closedAt: '2026-07-15T16:43:50.000Z',
		sourceRecord: {
			batchId: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
			digest:
				'78dadc18671e087b3e9169c34601c932d5215aafc1d14ae7ec81e9bf0ddc2426',
			rowNumber: '33493'
		},
		sellingAsset: {
			id: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
			type: 'credit_alphanum4',
			code: 'USDC',
			issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
		},
		buyingAsset: {
			id: 'PYUSD:GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5',
			type: 'credit_alphanum12',
			code: 'PYUSD',
			issuer: 'GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5'
		},
		amountPrecision: 'source_float64',
		id: '1848813589',
		seller: 'GA3RVV4CG6RCHZ4P3JQFS3PZHW3ZYIERNZL7JOTG7FUWSIQJSUNKNQ3Y',
		amount: '1074.6636081',
		price: {
			numerator: '5003537',
			denominator: '5000000'
		},
		deleted: false,
		lastModifiedLedger: 63490364
	}
} as const;
export const explorerIdentifierExamples = {
	operations: explorerRecordExamples.operation.id,
	assets: 'USDC:GBVVYDFLEBUNSWBHNJS3RSLLJTMJ46PJXTTMA3V6YJ4KDRMAEJIDUSDC',
	contracts: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA',
	offers: explorerRecordExamples.offer.id,
	trades: explorerRecordExamples.trade.id
} as const;
