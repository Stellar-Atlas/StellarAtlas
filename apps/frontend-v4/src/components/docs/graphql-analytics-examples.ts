const window = {
	minLedger: 63490364,
	maxLedger: 63490365,
	limit: 10,
	offset: 0
};

export const graphqlAnalyticsExamples = {
	events: {
		label: 'Historical contract events with decoded topics and data',
		query: `query ContractEvents($contractId: String!, $input: HubbleContractEventInput) {
  hubbleContractEvents(contractId: $contractId, input: $input) {
    contractId limit nextCursor
    items { id contractId type successful topicsJson dataJson classification { transactionKind eventKind sorobanExecutionEvidence provenance } }
    coverage { contiguousLastLedger maximumLedger gapCount }
    watermark { minimumLedger maximumLedger observedAt coverage }
  }
}`,
		variables: {
			contractId: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA',
			input: { minLedger: 63490364, maxLedger: 63490365, limit: 10 }
		}
	},
	balances: {
		label: 'Account balances (latest-ingested observations)',
		query: `query AccountBalances($account: String!, $input: HubbleAccountBalanceInput) {
  hubbleAccountBalances(account: $account, input: $input) {
    account balanceScope limit nextCursor
    balances { asset balance amountPrecision balanceRaw observedLedger lastModifiedLedger }
    coverage { contiguousLastLedger maximumLedger gapCount }
    watermark { mode catalogGeneratedAt catalogMaximumLedger snapshotPinned }
  }
}`,
		variables: {
			account: 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ',
			input: { limit: 10 }
		}
	},
	operations: {
		label: 'Payment operations and transaction hashes',
		query: `query Operations($input: HubbleOperationInput) {
  hubbleOperations(input: $input) {
    rows { id transactionHash sourceAccount type ledgerSequence details }
    window { minLedger maxLedger } coverageStatus semantics limit offset nextOffset
  }
}`,
		variables: { input: { ...window, type: 'payment' } }
	},
	assets: {
		label: 'Assets observed in a ledger window',
		query: `query Assets($input: HubbleAssetInput) {
  hubbleAssets(input: $input) {
    rows { id type code issuer }
    window { minLedger maxLedger } coverageStatus semantics limit offset nextOffset
  }
}`,
		variables: { input: window }
	},
	contracts: {
		label: 'Contracts observed in a ledger window',
		query: `query Contracts($input: HubbleExplorerPageInput) {
  hubbleContracts(input: $input) {
    rows { id }
    window { minLedger maxLedger } coverageStatus semantics limit offset nextOffset
  }
}`,
		variables: { input: window }
	},
	trades: {
		label: 'Trades, counterparties and exchanged assets',
		query: `query Trades($input: HubbleTradeInput) {
  hubbleTrades(input: $input) {
    rows { id ledgerSequence operationId seller buyer sellingAsset { id } buyingAsset { id } sellingAmount buyingAmount amountPrecision closedAt }
    window { minLedger maxLedger } coverageStatus semantics limit offset nextOffset
  }
}`,
		variables: { input: window }
	},
	offers: {
		label: 'Offer observations (not a current order book)',
		query: `query Offers($input: HubbleOfferInput) {
  hubbleOffers(input: $input) {
    rows { id seller sellingAsset { id } buyingAsset { id } amount amountPrecision deleted lastModifiedLedger }
    window { minLedger maxLedger } coverageStatus semantics limit offset nextOffset
  }
}`,
		variables: { input: window }
	},
	grouped: {
		label: 'Analytics: count operations by type',
		query: `query OperationCounts($input: HubbleQueryInput!) {
  hubbleQuery(input: $input) {
    dataset columns rows limit offset nextOffset
    aggregates { alias function field valueEncoding approximate }
    window { minLedger maxLedger } coverageStatus semantics
  }
}`,
		variables: {
			input: {
				dataset: 'history_operations',
				minLedger: 63490360,
				maxLedger: 63490365,
				groupBy: ['type_string'],
				aggregations: [{ function: 'COUNT', alias: 'records' }],
				orderBy: [{ field: 'records', direction: 'DESC' }],
				limit: 10,
				offset: 0
			}
		}
	}
} as const;
