import {
	amount,
	classicAddress,
	horizonAccountTimeoutMs,
	maximumInt64,
	parseHorizonTimestamp,
	parseLatestLedger,
	uint32
} from './HorizonAccountFields.js';

export interface ExplorerAccountBalanceDTO {
	readonly assetCode: string | null;
	readonly assetIssuer: string | null;
	readonly assetType: string;
	readonly balance: string;
	readonly exact?: ExplorerAccountBalanceExactDTO;
}

interface ExplorerAccountBalanceExactDTO {
	readonly assetId: string | null;
	readonly liquidityPoolId: string | null;
	readonly balanceRaw: string | null;
	readonly buyingLiabilities: string | null;
	readonly buyingLiabilitiesRaw: string | null;
	readonly sellingLiabilities: string | null;
	readonly sellingLiabilitiesRaw: string | null;
	readonly trustLineLimit: string | null;
	readonly trustLineLimitRaw: string | null;
	readonly isAuthorized: boolean | null;
	readonly isAuthorizedToMaintainLiabilities: boolean | null;
	readonly isClawbackEnabled: boolean | null;
	readonly sponsor: string | null;
}

export interface ExplorerAccountDTO {
	readonly accountId: string;
	readonly balances: readonly ExplorerAccountBalanceDTO[];
	readonly lastModifiedLedger: string | null;
	readonly sequence: string;
	readonly source: 'horizon';
	readonly subentryCount: number;
	readonly accounting?: ExplorerAccountAccountingDTO;
}

interface ExplorerAccountAccountingDTO {
	readonly scope: 'horizon_account_balances';
	readonly networkPassphrase: string;
	readonly snapshotStatus: 'ledger_bound' | 'ledger_unavailable';
	readonly latestLedger: string | null;
	readonly ledgerClosedAt: string | null;
	readonly baseReserveRaw: string | null;
	readonly baseReserveLedger: string | null;
	readonly subentryCount: string | null;
	readonly numSponsoring: string | null;
	readonly numSponsored: string | null;
	readonly balanceInventoryComplete: boolean;
}

interface HorizonAccountRecord {
	account_id?: string;
	balances?: HorizonBalanceRecord[];
	id?: string;
	last_modified_ledger?: number;
	num_sponsoring?: number;
	num_sponsored?: number;
	sequence?: string;
	subentry_count?: number;
}

interface HorizonBalanceRecord {
	asset_code?: string;
	asset_issuer?: string;
	asset_type?: string;
	balance?: string;
	buying_liabilities?: string;
	selling_liabilities?: string;
	limit?: string;
	liquidity_pool_id?: string;
	is_authorized?: boolean;
	is_authorized_to_maintain_liabilities?: boolean;
	is_clawback_enabled?: boolean;
	sponsor?: string;
}

interface AccountDetailOptions {
	readonly networkPassphrase: string;
	readonly signal: AbortSignal;
}

const searchTimeoutMs = 8_000;

export async function fetchExplorerAccount(
	horizonUrl: string,
	accountId: string,
	detail?: AccountDetailOptions
): Promise<ExplorerAccountDTO | null> {
	const classicDetail = detail !== undefined && accountId.startsWith('G');
	const timeout = AbortSignal.timeout(
		classicDetail ? horizonAccountTimeoutMs : searchTimeoutMs
	);
	const signal = detail ? AbortSignal.any([detail.signal, timeout]) : timeout;
	const base = horizonUrl.endsWith('/') ? horizonUrl : horizonUrl + '/';
	const response = await fetch(new URL('accounts/' + accountId, base), {
		headers: { Accept: 'application/json' },
		redirect: classicDetail ? 'error' : 'follow',
		signal
	});
	if (response.status === 404 && classicDetail) {
		const problem = (await response.json()) as {
			status?: unknown;
			type?: unknown;
		};
		if (
			problem?.status === 404 &&
			problem.type === 'https://stellar.org/horizon-errors/not_found'
		)
			return null;
		throw new Error('Unrecognized Horizon not-found response');
	}
	if (!response.ok || (classicDetail && response.status !== 200)) {
		void response.body?.cancel().catch(() => undefined);
		if (response.status === 404) return null;
		throw new Error('Horizon account request failed');
	}

	const record = (await response.json()) as HorizonAccountRecord;
	const id = record.account_id ?? record.id;
	if (
		typeof id !== 'string' ||
		typeof record.sequence !== 'string' ||
		typeof record.subentry_count !== 'number'
	)
		throw new Error('Account record missing from Horizon response');

	if (
		classicDetail &&
		(id !== accountId ||
			uint32(record.subentry_count) === null ||
			!/^(?:0|[1-9]\d{0,18})$/.test(record.sequence) ||
			BigInt(record.sequence) > maximumInt64 ||
			!Array.isArray(record.balances) ||
			!record.balances.every(isClassicBalanceRecord))
	)
		throw new Error('Horizon account detail is invalid');

	const balances = (record.balances ?? []).map((row) =>
		mapBalance(row, classicDetail)
	);
	const modified = uint32(record.last_modified_ledger);
	const legacy = {
		accountId: id,
		balances,
		lastModifiedLedger: modified?.toString() ?? null,
		sequence: record.sequence,
		source: 'horizon' as const,
		subentryCount: record.subentry_count
	};
	if (!detail || !classicDetail) return legacy;

	const latestLedger = parseLatestLedger(
		response.headers.get('latest-ledger'),
		modified
	);
	const assets = new Set(balances.map(({ exact }) => exact?.assetId));
	const balanceInventoryComplete =
		latestLedger !== null &&
		assets.has('native') &&
		assets.size === balances.length &&
		balances.every(
			({ exact }) => exact?.assetId != null && exact.balanceRaw !== null
		);
	const ledger =
		latestLedger !== null && balanceInventoryComplete
			? await fetchAccountLedger(base, latestLedger, signal)
			: null;
	return {
		...legacy,
		accounting: {
			scope: 'horizon_account_balances',
			networkPassphrase: detail.networkPassphrase,
			snapshotStatus:
				latestLedger === null ? 'ledger_unavailable' : 'ledger_bound',
			latestLedger,
			ledgerClosedAt: ledger?.closedAt ?? null,
			baseReserveRaw: ledger?.baseReserveRaw ?? null,
			baseReserveLedger: ledger?.baseReserveRaw != null ? latestLedger : null,
			subentryCount: record.subentry_count.toString(),
			numSponsoring: uint32(record.num_sponsoring)?.toString() ?? null,
			numSponsored: uint32(record.num_sponsored)?.toString() ?? null,
			balanceInventoryComplete
		}
	};
}

async function fetchAccountLedger(
	base: string,
	sequence: string,
	signal: AbortSignal
): Promise<{ closedAt: string | null; baseReserveRaw: string | null } | null> {
	if (signal.aborted) return null;
	try {
		const response = await fetch(new URL('ledgers/' + sequence, base), {
			headers: { Accept: 'application/json' },
			redirect: 'error',
			signal
		});
		if (response.status !== 200) {
			void response.body?.cancel().catch(() => undefined);
			return null;
		}
		const ledger = (await response.json()) as {
			sequence?: unknown;
			base_reserve_in_stroops?: unknown;
			closed_at?: unknown;
		};
		if (signal.aborted || uint32(ledger.sequence)?.toString() !== sequence)
			return null;
		return {
			closedAt: parseHorizonTimestamp(ledger.closed_at),
			baseReserveRaw: uint32(ledger.base_reserve_in_stroops)?.toString() ?? null
		};
	} catch {
		// The account inputs can remain useful when the matching ledger is unavailable.
		return null;
	}
}

function mapBalance(
	row: HorizonBalanceRecord,
	detail: boolean
): ExplorerAccountBalanceDTO {
	const balance = {
		assetCode: row.asset_code ?? null,
		assetIssuer: row.asset_issuer ?? null,
		assetType: row.asset_type ?? 'unknown',
		balance: typeof row.balance === 'string' ? row.balance : '0'
	};
	if (!detail) return balance;
	const liquidityPoolId =
		row.asset_type === 'liquidity_pool_shares' &&
		typeof row.liquidity_pool_id === 'string' &&
		/^[a-f0-9]{64}$/i.test(row.liquidity_pool_id)
			? row.liquidity_pool_id.toLowerCase()
			: null;
	const buying = amount(row.buying_liabilities);
	const selling = amount(row.selling_liabilities);
	const limit = amount(row.limit);
	return {
		...balance,
		exact: {
			assetId: assetId(row, liquidityPoolId),
			liquidityPoolId,
			balanceRaw: amount(row.balance)?.raw ?? null,
			buyingLiabilities: buying?.decimal ?? null,
			buyingLiabilitiesRaw: buying?.raw ?? null,
			sellingLiabilities: selling?.decimal ?? null,
			sellingLiabilitiesRaw: selling?.raw ?? null,
			trustLineLimit: limit?.decimal ?? null,
			trustLineLimitRaw: limit?.raw ?? null,
			isAuthorized: flag(row.is_authorized),
			isAuthorizedToMaintainLiabilities: flag(
				row.is_authorized_to_maintain_liabilities
			),
			isClawbackEnabled: flag(row.is_clawback_enabled),
			sponsor: classicAddress(row.sponsor)
		}
	};
}

function isClassicBalanceRecord(row: HorizonBalanceRecord): boolean {
	return (
		row != null &&
		typeof row.asset_type === 'string' &&
		row.asset_type.length > 0 &&
		typeof row.balance === 'string' &&
		(row.asset_code == null || typeof row.asset_code === 'string') &&
		(row.asset_issuer == null || typeof row.asset_issuer === 'string')
	);
}

function assetId(
	row: HorizonBalanceRecord,
	liquidityPoolId: string | null
): string | null {
	if (row.asset_type === 'native') return 'native';
	if (liquidityPoolId) return 'liquidity_pool_shares:' + liquidityPoolId;
	const { asset_type: type, asset_code: code, asset_issuer: issuer } = row;
	if (typeof code !== 'string' || typeof issuer !== 'string') return null;
	const pattern =
		type === 'credit_alphanum4'
			? /^[A-Za-z0-9]{1,4}$/
			: type === 'credit_alphanum12'
				? /^[A-Za-z0-9]{5,12}$/
				: null;
	return pattern?.test(code) && classicAddress(issuer) !== null
		? code + ':' + issuer
		: null;
}

function flag(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}
