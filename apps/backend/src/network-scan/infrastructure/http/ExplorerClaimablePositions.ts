import type { RequestHandler } from 'express';
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

type Role = 'claimant' | 'sponsor';

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

interface PositionPage {
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
const allowedQuery = ['role', 'limit', 'cursor'];

export function createExplorerClaimablePositionsHandler(config: {
	readonly horizonUrl: string;
	readonly networkPassphrase: string;
}): RequestHandler<{ accountId: string }> {
	const base = config.horizonUrl.endsWith('/')
		? config.horizonUrl
		: config.horizonUrl + '/';
	const cursorNetworkSupported = supportsClaimableCursorNetwork(config.networkPassphrase);
	return async (req, res) => {
		res.setHeader('Cache-Control', 'no-store');
		const accountId = classicAddress(req.params.accountId);
		const { role, cursor } = req.query;
		const limit = readLimit(req.query.limit);
		if (
			!accountId ||
			(role !== 'claimant' && role !== 'sponsor') ||
			limit === null ||
			Object.keys(req.query).some((key) => !allowedQuery.includes(key))
		) {
			return res
				.status(400)
				.json({ error: 'invalid_claimable_positions_query' });
		}

		if (!cursorNetworkSupported)
			return res.status(502).json({ error: 'claimable_positions_unavailable' });
		const scope: ClaimableCursorScope = [config.networkPassphrase, accountId, role];
		const after = cursor === undefined ? null : parsePagingToken(readClaimableCursor(cursor, scope));
		if (cursor !== undefined && after === null)
			return res
				.status(400)
				.json({
					error: 'invalid_claimable_positions_cursor',
					message: 'Restart claimable-position pagination without a cursor.'
				});

		const controller = new AbortController();
		const abort = () => controller.abort();
		res.once('close', abort);
		try {
			const url = new URL('claimable_balances', base);
			url.searchParams.set(role, accountId);
			url.searchParams.set('limit', String(limit));
			url.searchParams.set('order', 'desc');
			if (after) url.searchParams.set('cursor', pagingToken(after));
			const timeout = AbortSignal.timeout(horizonAccountTimeoutMs);
			const signal = AbortSignal.any([controller.signal, timeout]);
			const response = await fetch(url, {
				headers: { Accept: 'application/json' },
				redirect: 'error',
				signal
			});
			signal.throwIfAborted();
			if (response.status !== 200) {
				void response.body?.cancel().catch(() => undefined);
				if (response.status === 501)
					return res
						.status(501)
						.json({ error: 'claimable_positions_unsupported' });
				return res
					.status(502)
					.json({ error: 'claimable_positions_unavailable' });
			}
			const latestLedger = parseLatestLedger(
				response.headers.get('latest-ledger')
			);
			const payload = await readPageBody(response, signal);
			const page = parsePage(
				payload,
				accountId,
				role,
				limit,
				after,
				latestLedger,
				scope
			);
			const dto: PositionPage = {
				source: 'horizon',
				accountId,
				networkPassphrase: config.networkPassphrase,
				role,
				latestLedger,
				snapshotStatus:
					latestLedger === null ? 'ledger_unavailable' : 'ledger_bound',
				...page
			};
			return res.status(200).json(dto);
		} catch {
			if (!controller.signal.aborted)
				return res
					.status(502)
					.json({ error: 'claimable_positions_unavailable' });
		} finally {
			res.off('close', abort);
		}
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

function readLimit(value: unknown): number | null {
	if (value === undefined) return maxPageSize;
	if (typeof value !== 'string' || !/^[1-9]\d?$/.test(value)) return null;
	const limit = Number(value);
	return limit <= maxPageSize ? limit : null;
}

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function invalidPage(): never {
	throw new Error('Invalid Horizon claimable positions page');
}
