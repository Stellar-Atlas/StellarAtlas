import {
	encodeClaimableCursor,
	readClaimableCursor,
	supportsClaimableCursorNetwork,
	type ClaimableCursorScope
} from './ClaimablePositionCursor.js';
import {
	amount,
	classicAddress,
	horizonAccountTimeoutMs,
	maximumInt64,
	parseHorizonTimestamp,
	parseLatestLedger,
	uint32
} from './HorizonAccountFields.js';

import { accountRetryAfter, HorizonAccountReadError } from './HorizonAccountResponse.js';

export type Role = 'claimant' | 'sponsor';

type Predicate =
	| { readonly type: 'unconditional' }
	| {
			readonly type: 'and' | 'or';
			readonly predicates: readonly [Predicate, Predicate];
	  }
	| { readonly type: 'not'; readonly predicate: Predicate }
	| {
			readonly type: 'before_absolute_time';
			readonly epochSeconds: string;
			readonly isoTime: string | null;
	  }
	| { readonly type: 'before_relative_time'; readonly seconds: string };

interface Position {
	readonly id: string;
	readonly assetId: string;
	readonly amount: string;
	readonly amountRaw: string;
	readonly sponsor: string | null;
	readonly roles: readonly Role[];
	readonly claimants: readonly {
		readonly destination: string;
		readonly predicate: Predicate;
	}[];
	readonly lastModifiedLedger: string;
	readonly lastModifiedAt: string | null;
}

export interface PositionPage {
	readonly provider?: { readonly mode: 'operator_alternate'; readonly hostname: string; readonly observedAt?: string };
	readonly transmission: 'native' | 'operator_alternate';
	readonly observation: { readonly observedAt: string; readonly networkStatus: 'unconfirmed'; readonly freshness: 'unknown'; readonly latestLedgerClosedAt: null };
	readonly source: 'horizon';
	readonly accountId: string;
	readonly networkPassphrase: string;
	readonly role: Role;
	readonly latestLedger: string | null;
	readonly snapshotStatus: 'ledger_bound' | 'ledger_unavailable';
	readonly pageStatus: 'available' | 'partial';
	readonly positions: readonly Position[];
	readonly nextCursor: string | null;
}

interface PositionKey {
	readonly ledger: number;
	readonly id: string;
}

const maxPageSize = 25;
const maxBodyBytes = 1024 * 1024;
const idPattern = /^00000000[0-9a-f]{64}$/;
const pageKeyPattern = /^([1-9]\d{0,9})-(00000000[0-9a-f]{64})$/;

export interface ClaimablePageQuery {
	readonly accountId: string;
	readonly role: Role;
	readonly limit: number;
	/** Decoded token; the HTTP handler has already validated the account/network/role scope. */
	readonly after: string | null;
}

export class ClaimablePositionsUnsupportedError extends Error {}

/** One fixed-path request only. An as-of ledger does not prove network or chain freshness. */
export async function fetchExplorerClaimablePage(
	horizonUrl: string, query: ClaimablePageQuery,
	options: { readonly networkPassphrase: string; readonly signal: AbortSignal }
): Promise<PositionPage> {
	const { accountId, role, limit } = query;
	const after = query.after === null ? null : parsePagingToken(query.after);
	if (!classicAddress(accountId) || (role !== 'claimant' && role !== 'sponsor') ||
		!Number.isInteger(limit) || limit < 1 || limit > maxPageSize ||
		(query.after !== null && after === null) || !supportsClaimableCursorNetwork(options.networkPassphrase)) invalidPage();
	const scope: ClaimableCursorScope = [options.networkPassphrase, accountId, role];
	const url = new URL('claimable_balances', horizonUrl.endsWith('/') ? horizonUrl : horizonUrl + '/');
	url.searchParams.set(role, accountId);
	url.searchParams.set('limit', String(limit));
	url.searchParams.set('order', 'desc');
	if (after) url.searchParams.set('cursor', pagingToken(after));
	const signal = AbortSignal.any([options.signal, AbortSignal.timeout(horizonAccountTimeoutMs)]);
	const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal });
	signal.throwIfAborted();
	if (response.status !== 200) {
		void response.body?.cancel().catch(() => undefined);
		if (response.status === 501) throw new ClaimablePositionsUnsupportedError();
		throw new HorizonAccountReadError(accountRetryAfter(response));
	}
	const latestLedger = parseLatestLedger(response.headers.get('latest-ledger'));
	const payload = await readPageBody(response, signal);
	signal.throwIfAborted();
	return {
		source: 'horizon', accountId, networkPassphrase: options.networkPassphrase, role, latestLedger,
		transmission: 'native',
		observation: { observedAt: new Date().toISOString(), networkStatus: 'unconfirmed', freshness: 'unknown', latestLedgerClosedAt: null },
		snapshotStatus: latestLedger === null ? 'ledger_unavailable' : 'ledger_bound',
		...parsePage(payload, accountId, role, limit, after, latestLedger, scope)
	};
}

async function readPageBody(
	response: Response,
	signal: AbortSignal
): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Missing claimable page body');
	const cancel = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal.addEventListener('abort', cancel, { once: true });
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0;
	let text = '';
	try {
		while (true) {
			signal.throwIfAborted();
			const chunk = await reader.read();
			signal.throwIfAborted();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBodyBytes)
				throw new Error('Claimable page exceeds byte limit');
			text += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} catch (error) {
		cancel();
		throw error;
	} finally {
		signal.removeEventListener('abort', cancel);
		reader.releaseLock();
	}
}

function parsePage(
	value: unknown,
	accountId: string,
	role: Role,
	limit: number,
	after: PositionKey | null,
	latestLedger: string | null,
	scope: ClaimableCursorScope
): Pick<PositionPage, 'pageStatus' | 'positions' | 'nextCursor'> {
	const records = object(object(value)?._embedded)?.records;
	if (!Array.isArray(records) || records.length > limit) invalidPage();
	const seen = new Map<string, Position>();
	let last = after;
	for (const record of records) {
		const { position, key } = parsePosition(record, accountId, role);
		if (latestLedger !== null && key.ledger > Number(latestLedger))
			invalidPage();
		const previous = seen.get(key.id);
		if (previous) {
			if (JSON.stringify(previous) !== JSON.stringify(position)) invalidPage();
			continue;
		}
		if (
			last &&
			(key.ledger > last.ledger ||
				(key.ledger === last.ledger && key.id >= last.id))
		)
			invalidPage();
		seen.set(key.id, position);
		last = key;
	}
	return {
		pageStatus: seen.size === records.length ? 'available' : 'partial',
		positions: [...seen.values()],
		// A full upstream page permits another request, including an empty terminal page.
		nextCursor:
			records.length === limit && last
				? encodeClaimableCursor(scope, pagingToken(last))
				: null
	};
}

function parsePosition(
	value: unknown,
	accountId: string,
	role: Role
): {
	position: Position;
	key: PositionKey;
} {
	const row = object(value);
	if (!row || typeof row.id !== 'string' || !idPattern.test(row.id))
		invalidPage();
	const key = parsePagingToken(row.paging_token);
	if (
		!key ||
		key.id !== row.id ||
		key.ledger !== uint32(row.last_modified_ledger)
	)
		invalidPage();
	const principal = amount(row.amount);
	const assetId = parseAsset(row.asset);
	const sponsor = classicAddress(row.sponsor);
	if (
		!principal ||
		principal.raw === '0' ||
		!assetId ||
		(row.sponsor != null && sponsor === null) ||
		!Array.isArray(row.claimants) ||
		row.claimants.length === 0 ||
		row.claimants.length > 10
	)
		invalidPage();
	const destinations = new Set<string>();
	const claimants = row.claimants.map((value: unknown) => {
		const claimant = object(value);
		const destination = classicAddress(claimant?.destination);
		if (destination === null || destinations.has(destination)) invalidPage();
		destinations.add(destination);
		return { destination, predicate: parsePredicate(claimant?.predicate, 1) };
	});
	const roles: Role[] = [];
	if (destinations.has(accountId)) roles.push('claimant');
	if (sponsor === accountId) roles.push('sponsor');
	if (!roles.includes(role)) invalidPage();
	return {
		key,
		position: {
			id: key.id,
			assetId,
			amount: principal.decimal,
			amountRaw: principal.raw,
			sponsor,
			roles,
			claimants,
			lastModifiedLedger: String(key.ledger),
			lastModifiedAt: parseHorizonTimestamp(row.last_modified_time)
		}
	};
}

function parsePredicate(value: unknown, depth: number): Predicate {
	const row = object(value);
	if (!row || depth > 4) invalidPage();
	const keys = Object.keys(row);
	const tag = keys[0];
	if (
		keys.length === 1 &&
		tag === 'unconditional' &&
		row.unconditional === true
	)
		return { type: 'unconditional' };
	if (keys.length === 1 && (tag === 'and' || tag === 'or')) {
		const operands = row[tag];
		if (!Array.isArray(operands) || operands.length !== 2) invalidPage();
		return {
			type: tag,
			predicates: [
				parsePredicate(operands[0], depth + 1),
				parsePredicate(operands[1], depth + 1)
			]
		};
	}
	if (keys.length === 1 && tag === 'not')
		return { type: 'not', predicate: parsePredicate(row.not, depth + 1) };
	if (keys.length === 1 && tag === 'rel_before' && seconds(row.rel_before))
		return { type: 'before_relative_time', seconds: row.rel_before };
	if (
		keys.every((key) => key === 'abs_before' || key === 'abs_before_epoch') &&
		seconds(row.abs_before_epoch)
	) {
		const isoTime = parseHorizonTimestamp(row.abs_before);
		return {
			type: 'before_absolute_time',
			epochSeconds: row.abs_before_epoch,
			isoTime:
				isoTime !== null &&
				Date.parse(isoTime) / 1000 === Number(row.abs_before_epoch)
					? isoTime
					: null
		};
	}
	return invalidPage();
}

function parseAsset(value: unknown): string | null {
	if (value === 'native') return value;
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/.test(value)
	)
		return null;
	return classicAddress(value.slice(value.indexOf(':') + 1)) ? value : null;
}

function seconds(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^(?:0|[1-9]\d{0,18})$/.test(value) &&
		BigInt(value) <= maximumInt64
	);
}

function parsePagingToken(value: unknown): PositionKey | null {
	if (typeof value !== 'string') return null;
	const match = pageKeyPattern.exec(value);
	if (!match?.[2]) return null;
	const ledger = uint32(Number(match[1]));
	return ledger === null ? null : { ledger, id: match[2] };
}

function pagingToken(key: PositionKey): string {
	return key.ledger + '-' + key.id;
}

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function invalidPage(): never {
	throw new Error('Invalid Horizon claimable positions page');
}
