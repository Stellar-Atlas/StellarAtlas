import type { Request, Response, Router } from 'express';
import type { AssetMetadata } from '../asset-metadata/types.js';
import type { AssetCatalogue } from './AssetCatalogue.js';
import type { AssetIdentity } from './AssetIdentity.js';
import { assetReferenceInfo } from './AssetReferenceRegistry.js';

export type AssetRelatedMetadata = Pick<
	AssetMetadata,
	'status' | 'name' | 'logoUrl' | 'logoStatus' | 'homeDomain'
>;
export type AssetMetadataLoader = (
	asset: AssetIdentity
) => Promise<AssetRelatedMetadata>;

type ResolvableCatalogue = Pick<AssetCatalogue, 'resolve' | 'search'>;

export function registerAssetRelatedRoutes(
	router: Router,
	catalogue: ResolvableCatalogue,
	metadataLoader: AssetMetadataLoader
): void {
	router.get('/asset-metadata', (request, response) =>
		send(response, async () => {
			assertOnlyQuery(request, ['assets']);
			const raw = singleQuery(request, 'assets');
			if (raw.length > 8192) invalid('assets query is too long');
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				invalid('assets must be a JSON array of asset references');
			}
			if (!Array.isArray(parsed) || parsed.length > 16)
				invalid('assets must be a JSON array with at most 16 references');
			const references = [
				...new Set((parsed as readonly unknown[]).map(assetReference))
			];
			const resolved = await mapConcurrent(references, 4, async (reference) => {
				const value = await catalogue.resolve(reference);
				if (typeof value === 'string')
					invalid(
						'Asset reference is ambiguous; use CODE:ISSUER or a C address'
					);
				return value;
			});
			const unique = [
				...new Map(resolved.map((asset) => [asset.id, asset])).values()
			];
			const assets = await mapConcurrent(unique, 4, async (asset) => ({
				...asset,
				...(await metadataLoader(asset)),
				...referenceFields(asset)
			}));
			return { assets };
		})
	);

	router.get('/assets/:assetRef/similar', (request, response) =>
		send(response, async () => {
			assertOnlyQuery(request, ['limit', 'cursor']);
			const limit = parseLimit(singleQuery(request, 'limit', false));
			const cursor = singleQuery(request, 'cursor', false);
			if (cursor === '') invalid('Invalid cursor');
			if (cursor !== undefined && cursor.length > 2048)
				invalid('Invalid cursor');
			const reference = request.params.assetRef;
			if (!reference || reference.length > 160)
				invalid('Invalid asset reference');
			const value = await catalogue.resolve(reference);
			if (typeof value === 'string')
				invalid('Asset reference is ambiguous; use CODE:ISSUER or a C address');
			if (value.kind !== 'classic' || !value.code)
				invalid('Similar assets require a classic asset identity');
			const page = await catalogue.search({
				symbol: value.code,
				limit,
				...(cursor ? { cursor } : {})
			});
			const rows = Array.isArray(page.data)
				? (page.data as AssetIdentity[])
				: [];
			return {
				asset: { ...value, ...referenceFields(value) },
				data: rows
					.filter((asset) => asset.id !== value.id)
					.map((asset) => ({ ...asset, ...referenceFields(asset) })),
				nextCursor:
					typeof page.nextCursor === 'string' ? page.nextCursor : null,
				generatedAt:
					typeof page.generatedAt === 'string' ? page.generatedAt : null,
				semantics: 'same-symbol assets; not an assessment of legitimacy'
			};
		})
	);
}

function referenceFields(asset: AssetIdentity): {
	referenceIdentity: string | null;
	source: string | null;
} {
	const reference = assetReferenceInfo(asset.id);
	return {
		referenceIdentity: reference?.referenceIdentity ?? null,
		source: reference?.source ?? null
	};
}

function assertOnlyQuery(request: Request, allowed: readonly string[]): void {
	const accepted = new Set(allowed);
	for (const key of Object.keys(request.query))
		if (!accepted.has(key)) invalid('Unsupported query parameter: ' + key);
}

function singleQuery(request: Request, key: string): string;
function singleQuery(
	request: Request,
	key: string,
	required: false
): string | undefined;
function singleQuery(
	request: Request,
	key: string,
	required = true
): string | undefined {
	const value = request.query[key];
	if (value === undefined) {
		if (!required) return undefined;
		invalid('Invalid ' + key);
	}
	if (typeof value !== 'string') invalid('Invalid ' + key);
	if (required && value.length === 0) invalid('Invalid ' + key);
	return value;
}

function assetReference(value: unknown): string {
	if (typeof value !== 'string')
		invalid('Each asset reference must be a string');
	const reference = value.trim();
	if (!reference || reference.length > 160)
		invalid('Asset references must contain 1 to 160 characters');
	return reference;
}

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 25;
	if (!/^\d{1,3}$/.test(value)) invalid('limit must be between 1 and 100');
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
		invalid('limit must be between 1 and 100');
	return limit;
}

async function mapConcurrent<T, U>(
	items: readonly T[],
	concurrency: number,
	work: (item: T) => Promise<U>
): Promise<U[]> {
	const output = new Array<U>(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				output[index] = await work(items[index]!);
			}
		})
	);
	return output;
}

async function send(
	response: Response,
	action: () => Promise<unknown>
): Promise<void> {
	try {
		response.setHeader(
			'Cache-Control',
			'public, max-age=15, stale-while-revalidate=60'
		);
		response.json(await action());
	} catch (error) {
		if (error instanceof AssetRelatedInputError) {
			response
				.status(400)
				.json({ code: 'invalid_asset_request', error: error.message });
			return;
		}
		console.error('Asset related route failed', error);
		response.status(503).json({
			code: 'asset_resource_unavailable',
			error: 'Asset data is temporarily unavailable'
		});
	}
}

function invalid(message: string): never {
	throw new AssetRelatedInputError(message);
}

class AssetRelatedInputError extends Error {}
