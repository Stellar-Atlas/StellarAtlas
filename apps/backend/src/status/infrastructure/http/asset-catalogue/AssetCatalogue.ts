import {
	mkdir,
	readFile,
	stat,
	rename,
	writeFile,
	open,
	unlink
} from 'node:fs/promises';
import { join } from 'node:path';
import {
	AssetCatalogueSource,
	type AssetObservation
} from './AssetCatalogueSource.js';
import {
	nativeAsset,
	parseAssetReference,
	type AssetIdentity
} from './AssetIdentity.js';

interface CatalogueSnapshot {
	readonly version: 1;
	readonly generatedAt: string;
	readonly watermark: string;
	readonly maximumObservedLedger: number;
	readonly assets: readonly AssetObservation[];
}
export interface AssetSearch {
	readonly q?: string;
	readonly symbol?: string;
	readonly issuer?: string;
	readonly minLedger?: number;
	readonly maxLedger?: number;
	readonly startTime?: string;
	readonly endTime?: string;
	readonly limit: number;
	readonly cursor?: string;
}

/** A compact, shared catalogue is refreshed outside request handling. */
export class AssetCatalogue {
	private snapshot: CatalogueSnapshot | undefined;
	private readonly byId = new Map<string, AssetIdentity | AssetObservation>();
	private readonly byContract = new Map<
		string,
		AssetIdentity | AssetObservation
	>();
	private loadedAt = 0;
	private cacheMtime = 0;
	private orderedAssets: readonly (AssetIdentity | AssetObservation)[] = [];
	private request: Promise<void> | undefined;
	constructor(
		private readonly source: AssetCatalogueSource,
		private readonly cacheRoot: string,
		private readonly network: string
	) {
		this.indexNative();
	}
	async load(): Promise<void> {
		if (Date.now() - this.loadedAt < 10_000) return;
		if (this.request) return this.request;
		this.request = this.readSnapshot();
		try {
			await this.request;
		} finally {
			this.request = undefined;
		}
	}
	async issuerObservationsSnapshot(): Promise<{
		generatedAt: string | null;
		assets: readonly AssetObservation[];
	}> {
		await this.load();
		return {
			generatedAt: this.snapshot?.generatedAt ?? null,
			assets: this.snapshot?.assets ?? []
		};
	}
	private async readSnapshot(): Promise<void> {
		try {
			const info = await stat(join(this.cacheRoot, 'catalogue.json'));
			if (this.snapshot && info.mtimeMs === this.cacheMtime) {
				this.loadedAt = Date.now();
				return;
			}
			const raw = JSON.parse(
				await readFile(join(this.cacheRoot, 'catalogue.json'), 'utf8')
			) as CatalogueSnapshot;
			if (raw.version !== 1 || !Array.isArray(raw.assets))
				throw new Error('Invalid asset catalogue cache');
			if (raw.generatedAt !== this.snapshot?.generatedAt) {
				this.snapshot = raw;
				this.byId.clear();
				this.byContract.clear();
				this.indexNative();
				for (const asset of raw.assets) {
					this.byId.set(asset.id, asset);
					this.byContract.set(asset.contractId, asset);
				}
				this.orderedAssets = [...this.byId.values()].sort((a, b) =>
					a.id < b.id ? -1 : a.id > b.id ? 1 : 0
				);
			}
			this.cacheMtime = info.mtimeMs;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
				console.error('Asset catalogue cache read failed', error);
		}
		this.loadedAt = Date.now();
	}
	async resolve(
		reference: string
	): Promise<AssetIdentity | AssetObservation | string> {
		await this.load();
		const identity = parseAssetReference(reference, this.network);
		if (typeof identity === 'string') return identity;
		return (
			this.byId.get(identity.id) ??
			this.byContract.get(identity.contractId) ??
			identity
		);
	}
	async search(input: AssetSearch): Promise<Record<string, unknown>> {
		await this.load();
		const q = input.q?.trim(),
			cursor = decodeCursor(input.cursor, input);
		let identity: AssetIdentity | AssetObservation | string | undefined;
		if (q) {
			try {
				identity = await this.resolve(q);
			} catch {
				identity = q;
			}
		}
		const needle = (typeof identity === 'string' ? identity : q)?.toLowerCase();
		const rows = (
			typeof identity === 'object'
				? [identity]
				: this.orderedAssets.length
					? this.orderedAssets
					: [...this.byId.values()]
		).filter((asset) => {
			if (typeof identity === 'object' && identity.id !== asset.id)
				return false;
			if (
				typeof identity !== 'object' &&
				needle &&
				!asset.code?.toLowerCase().includes(needle) &&
				!asset.issuer?.toLowerCase().startsWith(needle) &&
				!asset.contractId.toLowerCase().startsWith(needle)
			)
				return false;
			if (input.symbol && asset.code !== input.symbol) return false;
			if (input.issuer && asset.issuer !== input.issuer) return false;
			const observation = 'firstObservedLedger' in asset ? asset : undefined;
			if (
				input.minLedger !== undefined &&
				(!observation || observation.lastObservedLedger < input.minLedger)
			)
				return false;
			if (
				input.maxLedger !== undefined &&
				(!observation || observation.firstObservedLedger > input.maxLedger)
			)
				return false;
			if (
				input.startTime &&
				(!observation ||
					Date.parse(observation.lastObservedAt) < Date.parse(input.startTime))
			)
				return false;
			if (
				input.endTime &&
				(!observation ||
					Date.parse(observation.firstObservedAt) >= Date.parse(input.endTime))
			)
				return false;
			return !cursor || asset.id > cursor;
		});
		const data = rows.slice(0, input.limit),
			last = data.at(-1);
		return {
			data,
			nextCursor:
				rows.length > input.limit && last ? encodeCursor(last.id, input) : null,
			generatedAt: this.snapshot?.generatedAt ?? null,
			coverage: {
				source: 'published-parsed-history',
				catalogueReady: !!this.snapshot,
				maximumObservedLedger: this.snapshot?.maximumObservedLedger ?? null,
				observedAssetCount: this.snapshot?.assets.length ?? 0
			},
			semantics:
				'Asset identities observed in published history. Observation bounds do not establish creation or complete chain history.'
		};
	}
	async refresh(): Promise<boolean> {
		await mkdir(this.cacheRoot, { recursive: true });
		const lock = join(this.cacheRoot, 'catalogue.lock');
		try {
			const info = await stat(lock);
			if (Date.now() - info.mtimeMs > 900_000) await unlink(lock);
		} catch {}
		let handle;
		try {
			handle = await open(lock, 'wx');
		} catch {
			return false;
		}
		try {
			await this.load();
			const update = await this.source.refresh(this.snapshot?.watermark);
			if (!update.watermark || update.watermark === this.snapshot?.watermark)
				return true;
			const merged = new Map(
				(this.snapshot?.assets ?? []).map((asset) => [asset.id, asset])
			);
			for (const asset of update.assets) {
				const previous = merged.get(asset.id);
				merged.set(
					asset.id,
					previous
						? {
								...asset,
								firstObservedLedger: Math.min(
									previous.firstObservedLedger,
									asset.firstObservedLedger
								),
								lastObservedLedger: Math.max(
									previous.lastObservedLedger,
									asset.lastObservedLedger
								),
								firstObservedAt:
									previous.firstObservedAt < asset.firstObservedAt
										? previous.firstObservedAt
										: asset.firstObservedAt,
								lastObservedAt:
									previous.lastObservedAt > asset.lastObservedAt
										? previous.lastObservedAt
										: asset.lastObservedAt
							}
						: asset
				);
			}
			const snapshot: CatalogueSnapshot = {
				version: 1,
				generatedAt: new Date().toISOString(),
				watermark: update.watermark,
				maximumObservedLedger: Math.max(
					this.snapshot?.maximumObservedLedger ?? 0,
					update.maxLedger
				),
				assets: [...merged.values()]
			};
			const temp = join(this.cacheRoot, 'catalogue.' + process.pid + '.tmp');
			await writeFile(temp, JSON.stringify(snapshot));
			await rename(temp, join(this.cacheRoot, 'catalogue.json'));
			this.loadedAt = 0;
			await this.load();
			return true;
		} finally {
			await handle.close();
			await unlink(lock).catch(() => undefined);
		}
	}
	start(): void {
		void this.load();
		const refresh = () =>
			void this.refresh().catch((error) =>
				console.error('Asset catalogue refresh failed', error)
			);
		refresh();
		setInterval(refresh, 900_000).unref();
	}
	private indexNative(): void {
		const asset = nativeAsset(this.network);
		this.byId.set(asset.id, asset);
		this.byContract.set(asset.contractId, asset);
	}
}

function scope(input: AssetSearch): string {
	return JSON.stringify([
		input.q ?? '',
		input.symbol ?? '',
		input.issuer ?? '',
		input.minLedger ?? null,
		input.maxLedger ?? null,
		input.startTime ?? null,
		input.endTime ?? null
	]);
}
function encodeCursor(id: string, input: AssetSearch): string {
	return Buffer.from(JSON.stringify([1, id, scope(input)])).toString(
		'base64url'
	);
}
function decodeCursor(
	cursor: string | undefined,
	input: AssetSearch
): string | undefined {
	if (!cursor) return undefined;
	try {
		if (cursor.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(cursor))
			throw new Error();
		const data: unknown = JSON.parse(
			Buffer.from(cursor, 'base64url').toString('utf8')
		);
		if (
			!Array.isArray(data) ||
			data.length !== 3 ||
			data[0] !== 1 ||
			typeof data[1] !== 'string' ||
			data[2] !== scope(input)
		)
			throw new Error();
		return data[1];
	} catch {
		throw new Error('Invalid cursor for these asset filters');
	}
}
