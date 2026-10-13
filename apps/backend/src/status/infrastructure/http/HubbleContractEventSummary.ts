import type { HubbleContractEventSummary } from './HubbleContractEventContracts.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

interface SummaryRequest {
	readonly executor: HubbleSemanticQueryExecutor;
	readonly database: string;
	readonly contractId: string;
	readonly minimumLedger: number;
	readonly maximumLedger: number;
	readonly fingerprint: string;
	readonly where: readonly string[];
	readonly parameters: readonly HubblePreparedParameter[];
}

interface CacheEntry {
	promise: Promise<HubbleContractEventSummary>;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const cacheTtlMilliseconds = 5 * 60_000;
const maximumCacheEntries = 128;

export function getHubbleContractEventSummary(
	request: SummaryRequest
): Promise<HubbleContractEventSummary> {
	const key = [
		request.database,
		request.contractId,
		request.minimumLedger,
		request.maximumLedger,
		request.fingerprint
	].join(':');
	const now = Date.now();
	for (const [cachedKey, entry] of cache) {
		if (entry.expiresAt > 0 && entry.expiresAt <= now) cache.delete(cachedKey);
	}
	const existing = cache.get(key);
	if (existing && (existing.expiresAt === 0 || existing.expiresAt > now))
		return existing.promise;

	const entry: CacheEntry = {
		promise: readSummary(request),
		expiresAt: 0
	};
	entry.promise = entry.promise
		.then((summary) => {
			entry.expiresAt = Date.now() + cacheTtlMilliseconds;
			return summary;
		})
		.catch((error: unknown) => {
			if (cache.get(key) === entry) cache.delete(key);
			throw error;
		});
	cache.delete(key);
	cache.set(key, entry);
	while (cache.size > maximumCacheEntries)
		cache.delete(cache.keys().next().value!);
	return entry.promise;
}

async function readSummary(
	request: SummaryRequest
): Promise<HubbleContractEventSummary> {
	const topicKeys =
		"arrayFilter(symbol -> symbol != '', arrayDistinct(arrayMap(raw -> JSONExtractString(raw, 'symbol'), JSONExtractArrayRaw(ifNull(toJSONString(topics_decoded), '[]')))))";
	const sql = [
		'SELECT toString(count()) AS total, sumMap(named_symbols, named_counts).1 AS topic_keys, sumMap(named_symbols, named_counts).2 AS topic_counts',
		'FROM (SELECT named_symbols, arrayMap(symbol -> toUInt64(1), named_symbols) AS named_counts',
		'FROM (SELECT ' + topicKeys + ' AS named_symbols',
		'FROM ' +
			quoteHubbleIdentifier(request.database) +
			'.history_contract_events',
		'WHERE ' + request.where.join(' AND ') + '))',
		'FORMAT JSON'
	].join('\n');
	const response = await request.executor.execute<Record<string, unknown>>(
		sql,
		request.parameters,
		100_000
	);
	const row = response.data?.[0];
	if (
		!row ||
		typeof row.total !== 'string' ||
		!Array.isArray(row.topic_keys) ||
		!Array.isArray(row.topic_counts)
	)
		throw new HubbleWarehouseUnavailableError(
			'Incomplete contract-event summary'
		);

	const counts = new Map<string, bigint>();
	for (let index = 0; index < row.topic_keys.length; index++) {
		const topic = row.topic_keys[index];
		const count = row.topic_counts[index];
		if (
			typeof topic === 'string' &&
			topic.length > 0 &&
			(typeof count === 'string' || typeof count === 'number')
		)
			counts.set(topic, BigInt(count));
	}
	const topics = [...counts]
		.sort(([left, leftCount], [right, rightCount]) =>
			leftCount === rightCount
				? left.localeCompare(right)
				: leftCount > rightCount
					? -1
					: 1
		)
		.slice(0, 128)
		.map(([topic, count]) => ({ topic, count: count.toString() }));
	return { total: row.total, topics };
}
