interface HorizonLedgerRecord {
	closed_at?: string;
	id?: string;
	protocol_version?: number;
	sequence?: number;
}

interface HorizonLedgerResponse {
	_embedded?: {
		records?: HorizonLedgerRecord[];
	};
}

interface HorizonTransactionRecord {
	created_at?: string;
	fee_charged?: string;
	hash?: string;
	ledger?: number;
	operation_count?: number;
	source_account?: string;
	successful?: boolean;
}

interface HorizonTransactionsResponse {
	_embedded?: {
		records?: HorizonTransactionRecord[];
	};
	_links?: {
		next?: {
			href?: string;
		};
	};
}

type CompleteHorizonTransactionRecord = Required<
	Omit<HorizonTransactionRecord, 'ledger'>
> &
	Pick<HorizonTransactionRecord, 'ledger'>;
type CompleteHorizonTransactionLookupRecord =
	Required<HorizonTransactionRecord>;

export interface LatestLedgerDTO {
	closedAt: string;
	protocolVersion: number;
	sequence: string;
}

export interface LedgerTransactionDTO {
	createdAt: string;
	feeCharged: string;
	hash: string;
	operationCount: number;
	sourceAccount: string;
	successful: boolean;
}

export interface TransactionLookupDTO extends LedgerTransactionDTO {
	ledger: string;
	source: 'horizon';
}

export interface RecentTransactionsDTO {
	generatedAt: string;
	limit: number;
	records: TransactionLookupDTO[];
	source: 'horizon';
	truncated: boolean;
}

export interface LedgerTransactionsDTO {
	ledger: string;
	records: LedgerTransactionDTO[];
	truncated: boolean;
}

const horizonPageLimit = 200;
const maxLedgerTransactionRecords = 600;

const getBaseUrl = (horizonUrl: string): string =>
	horizonUrl.endsWith('/') ? horizonUrl : `${horizonUrl}/`;

const buildHorizonLedgerTransactionsUrl = (
	horizonUrl: string,
	slotIndex: string
): string => {
	const url = new URL(
		`ledgers/${slotIndex}/transactions`,
		getBaseUrl(horizonUrl)
	);
	url.searchParams.set('order', 'asc');
	url.searchParams.set('limit', horizonPageLimit.toString());
	return url.toString();
};

const buildLatestLedgerUrl = (horizonUrl: string): string => {
	const url = new URL('ledgers', getBaseUrl(horizonUrl));
	url.searchParams.set('order', 'desc');
	url.searchParams.set('limit', '1');
	return url.toString();
};

const buildHorizonTransactionUrl = (horizonUrl: string, hash: string): string =>
	new URL(`transactions/${hash}`, getBaseUrl(horizonUrl)).toString();

const buildRecentTransactionsUrl = (
	horizonUrl: string,
	limit: number
): string => {
	const url = new URL('transactions', getBaseUrl(horizonUrl));
	url.searchParams.set('order', 'desc');
	url.searchParams.set('limit', limit.toString());
	return url.toString();
};

const isCompleteHorizonLedgerRecord = (
	record: HorizonLedgerRecord
): record is Required<HorizonLedgerRecord> =>
	typeof record.closed_at === 'string' &&
	typeof record.protocol_version === 'number' &&
	typeof record.sequence === 'number';

const isCompleteHorizonTransactionRecord = (
	record: HorizonTransactionRecord
): record is CompleteHorizonTransactionRecord =>
	typeof record.created_at === 'string' &&
	typeof record.fee_charged === 'string' &&
	typeof record.hash === 'string' &&
	typeof record.operation_count === 'number' &&
	typeof record.source_account === 'string' &&
	typeof record.successful === 'boolean';

const isCompleteHorizonTransactionLookupRecord = (
	record: HorizonTransactionRecord
): record is CompleteHorizonTransactionLookupRecord =>
	isCompleteHorizonTransactionRecord(record) &&
	typeof record.ledger === 'number';

const mapHorizonTransactionRecord = (
	record: CompleteHorizonTransactionRecord
): LedgerTransactionDTO => ({
	createdAt: record.created_at,
	feeCharged: record.fee_charged,
	hash: record.hash,
	operationCount: record.operation_count,
	sourceAccount: record.source_account,
	successful: record.successful
});

const mapHorizonTransactionLookupRecord = (
	record: CompleteHorizonTransactionLookupRecord
): TransactionLookupDTO => ({
	...mapHorizonTransactionRecord(record),
	ledger: record.ledger.toString(),
	source: 'horizon'
});

export const fetchLatestLedger = async (
	horizonUrl: string
): Promise<LatestLedgerDTO> => {
	const response = await fetch(buildLatestLedgerUrl(horizonUrl), {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(8_000)
	});
	if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}`);

	const payload = (await response.json()) as HorizonLedgerResponse;
	const record = payload._embedded?.records?.[0];
	if (!record || !isCompleteHorizonLedgerRecord(record))
		throw new Error('Latest ledger record missing from Horizon response');

	return {
		closedAt: record.closed_at,
		protocolVersion: record.protocol_version,
		sequence: record.sequence.toString()
	};
};

export const fetchTransactionByHash = async (
	horizonUrl: string,
	hash: string
): Promise<TransactionLookupDTO | null> => {
	const response = await fetch(buildHorizonTransactionUrl(horizonUrl, hash), {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(8_000)
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}`);

	const record = (await response.json()) as HorizonTransactionRecord;
	if (!isCompleteHorizonTransactionLookupRecord(record))
		throw new Error('Transaction record missing from Horizon response');

	return mapHorizonTransactionLookupRecord(record);
};

export const fetchRecentTransactions = async (
	horizonUrl: string,
	limit: number
): Promise<RecentTransactionsDTO> => {
	const response = await fetch(buildRecentTransactionsUrl(horizonUrl, limit), {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(8_000)
	});
	if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}`);

	const payload = (await response.json()) as HorizonTransactionsResponse;
	const pageRecords = payload._embedded?.records ?? [];
	return {
		generatedAt: new Date().toISOString(),
		limit,
		records: pageRecords
			.filter(isCompleteHorizonTransactionLookupRecord)
			.map(mapHorizonTransactionLookupRecord),
		source: 'horizon',
		truncated: typeof payload._links?.next?.href === 'string'
	};
};

export const fetchLedgerTransactions = async (
	horizonUrl: string,
	slotIndex: string
): Promise<LedgerTransactionsDTO> => {
	const records: LedgerTransactionDTO[] = [];
	let nextUrl: string | null = buildHorizonLedgerTransactionsUrl(
		horizonUrl,
		slotIndex
	);

	while (nextUrl && records.length < maxLedgerTransactionRecords) {
		const response = await fetch(nextUrl, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(12_000)
		});
		if (!response.ok)
			throw new Error(`Horizon returned HTTP ${response.status}`);

		const payload = (await response.json()) as HorizonTransactionsResponse;
		const pageRecords = payload._embedded?.records ?? [];
		records.push(
			...pageRecords
				.filter(isCompleteHorizonTransactionRecord)
				.map(mapHorizonTransactionRecord)
		);

		nextUrl =
			pageRecords.length > 0 && records.length < maxLedgerTransactionRecords
				? (payload._links?.next?.href ?? null)
				: null;
	}

	return {
		ledger: slotIndex,
		records: records.slice(0, maxLedgerTransactionRecords),
		truncated: records.length >= maxLedgerTransactionRecords
	};
};
