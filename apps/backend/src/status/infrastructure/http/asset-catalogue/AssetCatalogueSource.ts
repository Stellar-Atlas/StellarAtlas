import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';
import {
	classicAsset,
	nativeAsset,
	type AssetIdentity
} from './AssetIdentity.js';

export interface AssetObservation extends AssetIdentity {
	readonly firstObservedLedger: number;
	readonly lastObservedLedger: number;
	readonly firstObservedAt: string;
	readonly lastObservedAt: string;
}
export interface AssetRefresh {
	readonly assets: readonly AssetObservation[];
	readonly watermark: string;
	readonly maxLedger: number;
}

export class AssetCatalogueSource {
	private readonly endpoint: URL;
	private readonly database: string;
	private readonly headers: Record<string, string>;
	constructor(
		private readonly network: string,
		environment: NodeJS.ProcessEnv = process.env
	) {
		if (!environment.HUBBLE_CLICKHOUSE_URL)
			throw new Error('Asset catalogue warehouse is not configured');
		this.endpoint = new URL(environment.HUBBLE_CLICKHOUSE_URL);
		this.database = environment.HUBBLE_CLICKHOUSE_DATABASE ?? 'stellar_hubble';
		if (!/^[a-z][a-z0-9_]*$/.test(this.database))
			throw new Error('Invalid warehouse database');
		this.headers = { Accept: 'application/json' };
		if (environment.HUBBLE_CLICKHOUSE_USER)
			this.headers.Authorization =
				'Basic ' +
				Buffer.from(
					environment.HUBBLE_CLICKHOUSE_USER +
						':' +
						(environment.HUBBLE_CLICKHOUSE_PASSWORD ?? '')
				).toString('base64');
	}

	async refresh(since?: string): Promise<AssetRefresh> {
		const batches = await this.execute(
			`SELECT min(start_ledger) AS lo,max(end_ledger) AS hi,
			groupArray(toString(batch_id)) AS batch_ids,groupArray(tuple(start_ledger,end_ledger)) AS ranges,
			toString(max(updated)) AS watermark FROM (SELECT batch_id,
			argMax(start_ledger,updated_at) AS start_ledger,argMax(end_ledger,updated_at) AS end_ledger,
			max(updated_at) AS updated,argMax(status,updated_at) AS status
			FROM \`${this.database}\`._ingestion_batches GROUP BY batch_id HAVING status='complete')
			${since ? 'WHERE updated > {since:DateTime64(6)}' : ''} FORMAT JSON`,
			since ? { since } : {}
		);
		const batch = batches[0];
		if (!batch || !Number(batch.hi))
			return { assets: [], watermark: since ?? '', maxLedger: 0 };
		const lo = Number(batch.lo),
			hi = Number(batch.hi),
			watermark = String(batch.watermark);
		const ids = Array.isArray(batch.batch_ids) ? batch.batch_ids : [];
		if (
			ids.some(
				(value) =>
					typeof value !== 'string' ||
					!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
						value
					)
			)
		)
			throw new Error('Invalid published batch identities');
		const assets = new Map<string, AssetObservation>();
		const batchIdsParameter = `[${ids.map((id) => `'${id}'`).join(',')}]`;
		const affected = new Set<number>();
		if (since && Array.isArray(batch.ranges))
			for (const range of batch.ranges) {
				if (!Array.isArray(range) || range.length !== 2)
					throw new Error('Invalid asset refresh range');
				for (
					let partition = Math.floor(Number(range[0]) / 1048576);
					partition <= Math.floor(Number(range[1]) / 1048576);
					partition++
				)
					affected.add(partition);
			}
		// Match the existing ledger partitioning; one read runs at a time.
		for (let start = lo; start <= hi;) {
			const end = Math.min(hi, (Math.floor(start / 1048576) + 1) * 1048576 - 1);
			if (since && !affected.has(Math.floor(start / 1048576))) {
				start = end + 1;
				continue;
			}
			const page = await this.execute(
				`SELECT groupArray(tuple(asset_code,asset_issuer,first_ledger,last_ledger,first_at,last_at)) AS assets
				FROM (SELECT asset_code,asset_issuer,
				min(_ledger_sequence) AS first_ledger,max(_ledger_sequence) AS last_ledger,
				toString(min(closed_at)) AS first_at,toString(max(closed_at)) AS last_at
				FROM \`${this.database}\`.history_assets
				WHERE (asset_issuer != '' OR asset_type='native') AND _ledger_sequence BETWEEN {lo:UInt32} AND {hi:UInt32}
				${since ? 'AND _batch_id IN {batch_ids:Array(UUID)}' : ''}
				AND ${completedHubbleBatchPredicate(this.database)}
				GROUP BY asset_code,asset_issuer) FORMAT JSON`,
				{
					lo: String(start),
					hi: String(end),
					...(since ? { batch_ids: batchIdsParameter } : {})
				},
				100_000
			);
			const records = page[0]?.assets;
			if (!Array.isArray(records))
				throw new Error('Invalid asset catalogue aggregate');
			const rows = records.map((record: unknown) => {
				if (!Array.isArray(record) || record.length !== 6)
					throw new Error('Invalid asset catalogue observation');
				return {
					asset_code: record[0],
					asset_issuer: record[1],
					first_ledger: record[2],
					last_ledger: record[3],
					first_at: record[4],
					last_at: record[5]
				};
			});
			for (const row of rows) {
				const id = row.asset_issuer
					? String(row.asset_code) + ':' + String(row.asset_issuer)
					: 'native';
				const previous = assets.get(id),
					identity =
						previous ??
						(id === 'native'
							? nativeAsset(this.network)
							: classicAsset(
									String(row.asset_code),
									String(row.asset_issuer),
									this.network
								));
				assets.set(id, {
					...identity,
					firstObservedLedger: Math.min(
						previous?.firstObservedLedger ?? Infinity,
						Number(row.first_ledger)
					),
					lastObservedLedger: Math.max(
						previous?.lastObservedLedger ?? 0,
						Number(row.last_ledger)
					),
					firstObservedAt:
						previous && previous.firstObservedAt < utc(String(row.first_at))
							? previous.firstObservedAt
							: utc(String(row.first_at)),
					lastObservedAt:
						previous && previous.lastObservedAt > utc(String(row.last_at))
							? previous.lastObservedAt
							: utc(String(row.last_at))
				});
			}
			console.info(
				'Asset catalogue read through ledger',
				end,
				'unique assets',
				assets.size
			);
			start = end + 1;
		}
		return { assets: [...assets.values()], watermark, maxLedger: hi };
	}

	async issuerHomeDomain(issuer: string): Promise<string | null> {
		const rows = await this.execute(
			`SELECT argMax(home_domain,tuple(ledger_sequence,_row_number,_ingested_at)) AS home_domain
			FROM \`${this.database}\`.accounts PREWHERE account_id={issuer:String}
			WHERE ${completedHubbleBatchPredicate(this.database)} FORMAT JSON`,
			{ issuer },
			30_000
		);
		const value = rows[0]?.home_domain;
		return typeof value === 'string' && value.trim() ? value.trim() : null;
	}

	private async execute(
		sql: string,
		parameters: Readonly<Record<string, string>>,
		timeout = 30_000
	): Promise<Record<string, unknown>[]> {
		const url = new URL(this.endpoint);
		url.searchParams.set('query', sql);
		for (const [key, value] of Object.entries(parameters))
			url.searchParams.set('param_' + key, value);
		const response = await fetch(url, {
			method: 'POST',
			headers: this.headers,
			signal: AbortSignal.timeout(timeout)
		});
		if (!response.ok)
			throw new Error(
				'Asset catalogue warehouse query failed: HTTP ' +
					response.status +
					' ' +
					(await response.text()).slice(0, 1200)
			);
		const body: unknown = await response.json();
		if (
			!body ||
			typeof body !== 'object' ||
			!('data' in body) ||
			!Array.isArray(body.data)
		)
			throw new Error('Invalid asset catalogue warehouse response');
		return body.data as Record<string, unknown>[];
	}
}

function utc(value: string): string {
	return value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z');
}
