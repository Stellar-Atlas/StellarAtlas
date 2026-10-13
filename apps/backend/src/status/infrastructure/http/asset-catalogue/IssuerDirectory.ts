import type { AssetMetadataService } from '../asset-metadata/AssetMetadataService.js';
import type { AssetCatalogue } from './AssetCatalogue.js';

export interface IssuerDirectoryQuery {
	readonly q?: string;
	readonly limit: number;
	readonly cursor?: string;
}

interface IssuerRow {
	readonly id: string;
	readonly homeDomain: string | null;
	readonly assetCount: number;
	readonly firstObservedLedger: number;
	readonly lastObservedLedger: number;
	readonly links: {
		readonly self: string;
		readonly assets: string;
		readonly explorer: string;
	};
}

interface DirectorySnapshot {
	readonly generatedAt: string;
	readonly revision: number;
	readonly rows: readonly IssuerRow[];
	readonly domainsReady: boolean;
}

export class IssuerDirectory {
	private snapshot: DirectorySnapshot | undefined;
	private buildingFor: string | null = null;
	private enrichment: Promise<void> | undefined;
	private generation = 0;

	public constructor(
		private readonly catalogue: Pick<AssetCatalogue, 'issuerObservationsSnapshot'>,
		private readonly metadata: Pick<AssetMetadataService, 'getCachedIssuerHomeDomains'>
	) {}

	public async search(query: IssuerDirectoryQuery): Promise<{
		data: readonly IssuerRow[];
		nextCursor: string | null;
		generatedAt: string | null;
		domainsReady: boolean;
	}> {
		const source = await this.catalogue.issuerObservationsSnapshot();
		if (!source.generatedAt) return { data: [], nextCursor: null, generatedAt: null, domainsReady: false };
		if (this.snapshot?.generatedAt !== source.generatedAt && this.buildingFor !== source.generatedAt) {
			this.buildingFor = source.generatedAt;
			const revision = ++this.generation;
			const previousDomains = new Map<string, string | null>();
			for (const row of this.snapshot?.rows ?? [])
				previousDomains.set(row.id, row.homeDomain);
			const rows = groupIssuers(source.assets, previousDomains);
			this.snapshot = { generatedAt: source.generatedAt, revision, rows, domainsReady: rows.length === 0 };
			if (rows.length) {
				this.enrichment = this.enrichDomains(source.generatedAt, revision, rows);
				void this.enrichment.catch(() => undefined);
			}
		}
		let snapshot = this.snapshot!;
		const q = query.q?.trim().toLowerCase() ?? '';
		if (q && !/^g[a-z2-7]{0,55}$/.test(q) && !snapshot.domainsReady && this.enrichment) {
			await this.enrichment;
			snapshot = this.snapshot!;
		}
		const cursor = decodeCursor(query.cursor, snapshot, q);
		const matches = snapshot.rows.filter((row) =>
			!q || row.id.toLowerCase().startsWith(q) || (row.homeDomain?.toLowerCase().includes(q) ?? false)
		);
		const remaining = cursor ? matches.filter((row) => compareRows(row, cursor) > 0) : matches;
		const data = remaining.slice(0, query.limit);
		const last = data.at(-1);
		return {
			data,
			nextCursor: remaining.length > query.limit && last ? encodeCursor(last, snapshot, q) : null,
			generatedAt: snapshot.generatedAt,
			domainsReady: snapshot.domainsReady
		};
	}

	private async enrichDomains(generatedAt: string, revision: number, rows: readonly IssuerRow[]): Promise<void> {
		try {
			const domains = await this.metadata.getCachedIssuerHomeDomains();
			const enriched = rows.map((row) => domains.has(row.id)
				? { ...row, homeDomain: domains.get(row.id) ?? null }
				: row);
			if (this.generation !== revision || this.snapshot?.generatedAt !== generatedAt) return;
			this.snapshot = { generatedAt, revision: revision + 1, rows: sortRows(enriched), domainsReady: true };
		} catch {
			if (this.generation === revision && this.snapshot?.generatedAt === generatedAt)
				this.snapshot = { ...this.snapshot, domainsReady: false };
		}
	}
}

function groupIssuers(
	assets: Awaited<ReturnType<AssetCatalogue['issuerObservationsSnapshot']>>['assets'],
	previousDomains: ReadonlyMap<string, string | null>
): IssuerRow[] {
	const issuers = new Map<string, { assetCount: number; firstObservedLedger: number; lastObservedLedger: number }>();
	for (const asset of assets) {
		if (asset.kind !== 'classic' || !asset.issuer) continue;
		const current = issuers.get(asset.issuer);
		if (current) {
			current.assetCount++;
			current.firstObservedLedger = Math.min(current.firstObservedLedger, asset.firstObservedLedger);
			current.lastObservedLedger = Math.max(current.lastObservedLedger, asset.lastObservedLedger);
		} else {
			issuers.set(asset.issuer, {
				assetCount: 1,
				firstObservedLedger: asset.firstObservedLedger,
				lastObservedLedger: asset.lastObservedLedger
			});
		}
	}
	return sortRows([...issuers].map(([id, value]) => ({
		id, homeDomain: previousDomains.get(id) ?? null, ...value,
		links: { self: '/v1/issuers/' + id, assets: '/v1/issuers/' + id + '/assets', explorer: '/explorer/issuers/' + id }
	})));
}

function sortRows(rows: readonly IssuerRow[]): IssuerRow[] {
	return [...rows].sort((left, right) => {
		const leftDomain = left.homeDomain?.toLowerCase() ?? '\uffff';
		const rightDomain = right.homeDomain?.toLowerCase() ?? '\uffff';
		return leftDomain < rightDomain ? -1 : leftDomain > rightDomain ? 1 :
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
	});
}

function compareRows(row: IssuerRow, cursor: { readonly homeDomain: string | null; readonly id: string }): number {
	const leftDomain = row.homeDomain?.toLowerCase() ?? '\uffff';
	const rightDomain = cursor.homeDomain?.toLowerCase() ?? '\uffff';
	return leftDomain < rightDomain ? -1 : leftDomain > rightDomain ? 1 :
		row.id < cursor.id ? -1 : row.id > cursor.id ? 1 : 0;
}

function encodeCursor(row: IssuerRow, snapshot: DirectorySnapshot, q: string): string {
	return Buffer.from(JSON.stringify([1, snapshot.generatedAt, snapshot.revision, q, row.homeDomain, row.id])).toString('base64url');
}

function decodeCursor(cursor: string | undefined, snapshot: DirectorySnapshot, q: string): { readonly homeDomain: string | null; readonly id: string } | null {
	if (!cursor) return null;
	try {
		if (cursor.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error();
		const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		if (!Array.isArray(value) || value.length !== 6 || value[0] !== 1 ||
			value[1] !== snapshot.generatedAt || value[2] !== snapshot.revision ||
			value[3] !== q || !(typeof value[4] === 'string' || value[4] === null) ||
			typeof value[5] !== 'string') throw new Error();
		return { homeDomain: value[4], id: value[5] };
	} catch {
		throw new Error('Invalid issuer cursor for these filters');
	}
}
