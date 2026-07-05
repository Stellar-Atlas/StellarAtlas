import type {
	ExplorerOperationDTO,
	ExplorerOperationsDTO
} from './BlockchainExplorerClient.js';

interface HorizonOperationRecord {
	created_at?: string;
	id?: string;
	ledger?: number;
	source_account?: string;
	transaction_hash?: string;
	transaction_successful?: boolean;
	type?: string;
	type_i?: number;
}

interface HorizonRecordsResponse<RecordType> {
	_embedded?: {
		records?: RecordType[];
	};
	_links?: {
		next?: {
			href?: string;
		};
	};
}

const horizonLimit = 200;
const maxFetchedRecords = 600;

const getBaseUrl = (horizonUrl: string): string =>
	horizonUrl.endsWith('/') ? horizonUrl : `${horizonUrl}/`;

export const fetchExplorerTransactionOperations = async (
	horizonUrl: string,
	hash: string
): Promise<ExplorerOperationsDTO | null> => {
	const firstUrl = new URL(
		`transactions/${hash}/operations`,
		getBaseUrl(horizonUrl)
	);
	firstUrl.searchParams.set('limit', horizonLimit.toString());
	firstUrl.searchParams.set('order', 'asc');

	const payload = await fetchHorizonPage<HorizonOperationRecord>(
		firstUrl.toString()
	);
	if (payload === null) return null;

	return {
		filters: { transactionHash: hash },
		records: payload.records.map(mapOperation),
		source: 'horizon',
		truncated: payload.truncated
	};
};

async function fetchHorizonPage<RecordType>(
	firstUrl: string
): Promise<{
	readonly records: readonly RecordType[];
	readonly truncated: boolean;
} | null> {
	const records: RecordType[] = [];
	let nextUrl: string | null = firstUrl;

	while (nextUrl && records.length < maxFetchedRecords) {
		const response = await fetch(nextUrl, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(12_000)
		});
		if (response.status === 404) return null;
		if (!response.ok)
			throw new Error(`Horizon returned HTTP ${response.status}`);

		const payload =
			(await response.json()) as HorizonRecordsResponse<RecordType>;
		const pageRecords = payload._embedded?.records ?? [];
		records.push(...pageRecords);
		nextUrl =
			pageRecords.length > 0 && records.length < maxFetchedRecords
				? (payload._links?.next?.href ?? null)
				: null;
	}

	return {
		records: records.slice(0, maxFetchedRecords),
		truncated: nextUrl !== null
	};
}

function mapOperation(record: HorizonOperationRecord): ExplorerOperationDTO {
	return {
		createdAt: record.created_at ?? '',
		id: record.id ?? '',
		ledger: typeof record.ledger === 'number' ? record.ledger.toString() : null,
		source: 'horizon',
		sourceAccount: record.source_account ?? null,
		successful: record.transaction_successful ?? null,
		transactionHash: record.transaction_hash ?? null,
		type: record.type ?? 'unknown',
		typeNumber: record.type_i ?? null
	};
}
