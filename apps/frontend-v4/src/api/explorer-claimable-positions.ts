import { recordValue } from './explorer-analytics';
import { classicAssetIdentity, parseCurrentAccountProvider, type CurrentAccountProvider, type ClassicAssetIdentity } from './explorer-current-account';
import { currentLedgerSequence, publicNetworkPassphrase } from './explorer-current-account-snapshot';
import { claimablePageBytes, claimablePageSize, isClaimableCursor, isClaimableRole, type ClaimableRole } from '../domain/claimable-positions';
import { isClassicAccount } from '../domain/classic-account';

export type ClaimPredicate =
	| { readonly type: 'unconditional' }
	| { readonly type: 'and' | 'or'; readonly predicates: readonly [ClaimPredicate, ClaimPredicate] }
	| { readonly type: 'not'; readonly predicate: ClaimPredicate }
	| { readonly type: 'before_absolute_time'; readonly epochSeconds: string; readonly isoTime: string | null }
	| { readonly type: 'before_relative_time'; readonly seconds: string };

export interface ClaimablePosition {
	readonly id: string;
	readonly asset: ClassicAssetIdentity | 'native';
	readonly amountRaw: string;
	readonly sponsor: string | null;
	readonly roles: readonly ClaimableRole[];
	readonly claimants: readonly { readonly destination: string; readonly predicate: ClaimPredicate }[];
	readonly lastModifiedLedger: string;
	readonly lastModifiedAt: string | null;
}

export interface ClaimablePageFailure {
	readonly status: 'unsupported' | 'unavailable';
	readonly provider: CurrentAccountProvider | null;
	readonly transmission: 'native' | 'operator_alternate' | 'unconfirmed';
	readonly retryAfterSeconds: number | null;
}

export interface ClaimablePage {
	readonly provider: CurrentAccountProvider | null;
	readonly transmission: 'native' | 'operator_alternate';
	readonly observation: { readonly observedAt: string; readonly networkStatus: 'unconfirmed'; readonly freshness: 'unknown'; readonly latestLedgerClosedAt: null };
	readonly latestLedger: string | null;
	readonly partial: boolean;
	readonly positions: readonly ClaimablePosition[];
	readonly nextCursor: string | null;
}

const maxInt64 = 0x7fff_ffff_ffff_ffffn;

function invalid(): never {
	throw new Error('Invalid claimable positions response');
}

function int64(value: unknown): value is string {
	return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= maxInt64;
}

function optionalTime(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) invalid();
	const wall = value.slice(0, 19), normalized = new Date(wall + 'Z');
	if (!Number.isFinite(Date.parse(value)) || !Number.isFinite(+normalized) || normalized.toISOString().slice(0, 19) !== wall) invalid();
	return value;
}

function predicate(value: unknown, depth = 1): ClaimPredicate {
	if (depth > 4) invalid();
	const row = recordValue(value);
	switch (row.type) {
		case 'unconditional': return { type: row.type };
		case 'and':
		case 'or':
			if (!Array.isArray(row.predicates) || row.predicates.length !== 2) invalid();
			return { type: row.type, predicates: [predicate(row.predicates[0], depth + 1), predicate(row.predicates[1], depth + 1)] };
		case 'not': return { type: row.type, predicate: predicate(row.predicate, depth + 1) };
		case 'before_absolute_time': {
			if (!int64(row.epochSeconds)) invalid();
			const isoTime = optionalTime(row.isoTime);
			if (isoTime !== null && Date.parse(isoTime) / 1000 !== Number(row.epochSeconds)) invalid();
			return { type: row.type, epochSeconds: row.epochSeconds, isoTime };
		}
		case 'before_relative_time':
			if (!int64(row.seconds)) invalid();
			return { type: row.type, seconds: row.seconds };
		default: return invalid();
	}
}

function position(value: unknown, account: string, role: ClaimableRole, latestLedger: string | null): ClaimablePosition {
	const row = recordValue(value);
	const asset = row.assetId === 'native' ? 'native' : typeof row.assetId === 'string' ? classicAssetIdentity(row.assetId) : null;
	const lastModifiedLedger = currentLedgerSequence(row.lastModifiedLedger);
	const sponsor = row.sponsor;
	if (typeof row.id !== 'string' || !/^00000000[a-f0-9]{64}$/.test(row.id) ||
		asset === null || lastModifiedLedger === null || (latestLedger !== null && Number(lastModifiedLedger) > Number(latestLedger)) ||
		(sponsor !== null && (typeof sponsor !== 'string' || !isClassicAccount(sponsor))) ||
		!int64(row.amountRaw) || row.amountRaw === '0' || typeof row.amount !== 'string' ||
		!/^(0|[1-9]\d{0,11})(?:\.\d{1,7})?$/.test(row.amount) ||
		!Array.isArray(row.claimants) || row.claimants.length < 1 || row.claimants.length > 10) invalid();
	const [whole = '', fraction = ''] = row.amount.split('.');
	if (BigInt(whole + fraction.padEnd(7, '0')).toString() !== row.amountRaw) invalid();
	const destinations = new Set<string>();
	const claimants = row.claimants.map((value: unknown) => {
		const entry = recordValue(value);
		if (typeof entry.destination !== 'string' || !isClassicAccount(entry.destination) || destinations.has(entry.destination)) invalid();
		destinations.add(entry.destination);
		return { destination: entry.destination, predicate: predicate(entry.predicate) };
	});
	const roles: ClaimableRole[] = [];
	if (destinations.has(account)) roles.push('claimant');
	if (sponsor === account) roles.push('sponsor');
	const reportedRoles = row.roles;
	if (!roles.includes(role) || !Array.isArray(reportedRoles) || reportedRoles.length !== roles.length ||
		!roles.every(value => reportedRoles.includes(value))) invalid();
	return { id: row.id, asset, amountRaw: row.amountRaw, sponsor, roles, claimants, lastModifiedLedger,
		lastModifiedAt: optionalTime(row.lastModifiedAt) };
}

export function parseClaimablePage(account: string, role: ClaimableRole, payload: unknown): ClaimablePage {
	const row = recordValue(payload);
	const ledger = currentLedgerSequence(row.latestLedger);
	const provider = parseCurrentAccountProvider(row.provider);
	if (row.transmission !== (provider ? 'operator_alternate' : 'native')) invalid();
	const observation = recordValue(row.observation);
	const observedAt = optionalTime(observation.observedAt);
	if (observedAt === null || observation.networkStatus !== 'unconfirmed' || observation.freshness !== 'unknown' ||
		observation.latestLedgerClosedAt !== null || (provider && provider.observedAt !== observedAt)) invalid();
	if (!isClassicAccount(account) || row.source !== 'horizon' || row.networkPassphrase !== publicNetworkPassphrase ||
		row.accountId !== account || row.role !== role ||
		!(row.snapshotStatus === 'ledger_bound' && ledger !== null || row.snapshotStatus === 'ledger_unavailable' && row.latestLedger === null) ||
		(row.pageStatus !== 'available' && row.pageStatus !== 'partial') ||
		(row.nextCursor !== null && !isClaimableCursor(row.nextCursor)) ||
		!Array.isArray(row.positions) || row.positions.length > claimablePageSize) invalid();
	const unique = new Map<string, ClaimablePosition>();
	let duplicate = false;
	for (const candidate of row.positions) {
		const item = position(candidate, account, role, ledger);
		const previous = unique.get(item.id);
		if (previous) {
			// The typed projection fixes key order and normalizes roles and exact amounts.
			// Do not pick a winner if two rows disagree about the same position.
			if (JSON.stringify(previous) !== JSON.stringify(item)) invalid();
			duplicate = true;
		} else unique.set(item.id, item);
	}
	return { provider, transmission: provider ? 'operator_alternate' : 'native', observation: { observedAt, networkStatus: 'unconfirmed', freshness: 'unknown', latestLedgerClosedAt: null }, latestLedger: ledger, partial: duplicate || row.pageStatus === 'partial', positions: [...unique.values()], nextCursor: row.nextCursor };
}

export async function fetchClaimablePage(account: string, role: ClaimableRole, cursor: string | null, signal: AbortSignal): Promise<ClaimablePage | ClaimablePageFailure> {
	if (!isClassicAccount(account) || !isClaimableRole(role) || (cursor !== null && !isClaimableCursor(cursor))) invalid();
	const query = new URLSearchParams({ role });
	if (cursor !== null) query.set('cursor', cursor);
	const response = await fetch('/api/explorer/claimable-positions/' + account + '?' + query, {
		headers: { accept: 'application/json' }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal
	});
	if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' ||
		Number(response.headers.get('content-length')) > claimablePageBytes || !response.body) {
		void response.body?.cancel().catch(() => undefined);
		if (response.status === 501) return { status: 'unsupported', provider: null, transmission: 'unconfirmed', retryAfterSeconds: null };
		invalid();
	}
	const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0, text = '';
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > claimablePageBytes) invalid();
			text += decoder.decode(chunk.value, { stream: true });
		}
		const payload: unknown = JSON.parse(text + decoder.decode());
		if (response.status !== 200) {
			const row = recordValue(payload), provider = parseCurrentAccountProvider(row.provider);
			if (provider && row.transmission !== 'operator_alternate') invalid();
			const retry = response.headers.get('retry-after');
			const seconds = retry !== null && /^\d{1,3}$/.test(retry) ? Number(retry) : 0;
			return { status: response.status === 501 ? 'unsupported' : 'unavailable', provider,
				transmission: provider ? 'operator_alternate' : row.transmission === 'native' ? 'native' : 'unconfirmed',
				retryAfterSeconds: seconds >= 1 && seconds <= 300 ? seconds : null };
		}
		return parseClaimablePage(account, role, payload);
	} finally {
		void reader.cancel().catch(() => undefined);
	}
}
