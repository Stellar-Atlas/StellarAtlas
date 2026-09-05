export const graphqlExamples = {
	transfers: {
		label: 'Exact asset transfers (typed, cursor-paginated)',
		query: `query Transfers($input: HubbleTransferInput) {
  hubbleTransfers(input: $input) {
    limit nextCursor elapsedMilliseconds
    watermark { minimumLedger maximumLedger observedAt coverage }
    transfers {
      id ledgerSequence closedAt transactionHash from to eventTopic
      amountRaw amountScale asset { id type code issuer }
    }
  }
}`,
		variables: {
			input: {
				asset: 'native',
				eventTopic: 'transfer',
				minLedger: 26000000,
				maxLedger: 26000099,
				limit: 10
			}
		}
	},
	ledgers: {
		label: 'Paginated ledger rows',
		query: `query LedgerRows($input: HubbleQueryInput!) {
  hubbleQuery(input: $input) {
    dataset columns limit offset elapsedMilliseconds rows
  }
}`,
		variables: {
			input: {
				dataset: 'history_ledgers',
				filters: [
					{ field: 'sequence', operator: 'GTE', value: 2 },
					{ field: 'sequence', operator: 'LTE', value: 65 }
				],
				select: ['sequence', 'protocol_version'],
				orderBy: [{ field: 'sequence', direction: 'ASC' }],
				limit: 10,
				offset: 0
			}
		}
	},
	coverage: {
		label: 'Current ingestion coverage',
		query: `query Coverage {
  hubbleStatus {
    servingWarehouse minimumLedger maximumLedger
    completedBatches failedBatches datasetCount
    coverage {
      contiguousFirstLedger contiguousLastLedger contiguousLedgerCount
      supplementalLedgerCount totalLedgerCount nextLedger gapCount
    }
  }
}`,
		variables: {}
	},
	schema: {
		label: 'Datasets and filterable columns',
		query: `query Datasets {
  hubbleDatasets { name rowCount columns { name type } }
}`,
		variables: {}
	}
} as const;

export function parseGraphqlVariables(text: string): Record<string, unknown> {
	const variables: unknown = JSON.parse(text);
	if (!isRecord(variables)) throw new Error('Variables must be a JSON object.');
	return variables;
}

export function graphqlPageVariables(
	variablesText: string,
	result: unknown,
	direction: -1 | 1
): string | null {
	const variables = parseGraphqlVariables(variablesText);
	if (!isRecord(variables.input) || !isRecord(result) || result.errors)
		return null;
	const data = result.data;
	if (!isRecord(data)) return null;
	const typedPage =
		data.hubbleTransfers ??
		data.hubbleAccountTransfers ??
		data.hubbleAssetTransfers;
	if (isRecord(typedPage)) {
		if (
			direction < 0 ||
			typeof typedPage.nextCursor !== 'string' ||
			!typedPage.nextCursor
		)
			return null;
		return JSON.stringify(
			{
				...variables,
				input: { ...variables.input, after: typedPage.nextCursor }
			},
			null,
			2
		);
	}
	if (!isRecord(data.hubbleQuery)) return null;
	const page = data.hubbleQuery;
	if (
		typeof page.limit !== 'number' ||
		page.limit < 1 ||
		typeof page.offset !== 'number' ||
		!Array.isArray(page.rows)
	)
		return null;
	if (direction < 0 && page.offset === 0) return null;
	if (direction > 0 && page.rows.length < page.limit) return null;
	return JSON.stringify(
		{
			...variables,
			input: {
				...variables.input,
				offset: Math.max(0, page.offset + direction * page.limit)
			}
		},
		null,
		2
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
