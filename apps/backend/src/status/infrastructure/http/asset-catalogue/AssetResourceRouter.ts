import express, { type Request, type Response, type Router } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { join } from 'node:path';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { registerHubbleSemanticRoutes } from '../HubbleSemanticRoutes.js';
import { registerHubbleTransferRoutes } from '../HubbleTransferRoutes.js';
import { registerHubbleExplorerRoutes } from '../HubbleExplorerRoutes.js';
import { AssetMetadataService } from '../asset-metadata/AssetMetadataService.js';
import { AssetCatalogue, type AssetSearch } from './AssetCatalogue.js';
import { AssetCatalogueSource } from './AssetCatalogueSource.js';
import { IssuerDirectory } from './IssuerDirectory.js';
import type { AssetIdentity } from './AssetIdentity.js';
import { registerAssetRelatedRoutes } from './AssetRelatedRoutes.js';
import { registerHubbleAssetSnapshotRoutes } from '../HubbleAssetSnapshotRoutes.js';
import { registerHubblePoolSnapshotRoutes } from '../HubblePoolSnapshotRoutes.js';
import { registerHubbleAssetReportRoutes } from '../HubbleAssetReportRoutes.js';
import { registerHubbleContractEventRoutes } from '../HubbleContractEventRoutes.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';
import { registerHubbleDatasetRoutes } from '../HubbleWarehouseRouter.js';
import { contractProvenanceRouter } from '../contract-provenance/ContractProvenanceRouter.js';

export interface AssetResourceConfig {
	readonly rpcUrl?: string;
	readonly networkPassphrase: string;
	readonly cacheRoot?: string;
	readonly warehouse: HubbleWarehouse;
	readonly catalogue?: AssetCatalogue;
	readonly metadata?: AssetMetadataService;
	readonly source?: AssetCatalogueSource;
}

export function assetResourceRouter(config: AssetResourceConfig): Router {
	const root =
		config.cacheRoot ??
		process.env.ASSET_METADATA_CACHE_ROOT ??
		'/mnt/stellaratlas_assets';
	const source =
		config.source ?? new AssetCatalogueSource(config.networkPassphrase);
	const catalogue =
		config.catalogue ??
		new AssetCatalogue(
			source,
			join(root, 'catalogue'),
			config.networkPassphrase
		);
	const metadata =
		config.metadata ??
		new AssetMetadataService({
			networkPassphrase: config.networkPassphrase,
			cacheRoot: join(root, 'metadata'),
			resolveIssuerHomeDomain: (issuer) => source.issuerHomeDomain(issuer)
		});
	const issuerDirectory = new IssuerDirectory(catalogue, metadata);
	const router = express.Router();
	router.use(
		contractProvenanceRouter({
			rpcUrl: config.rpcUrl ?? process.env.STELLAR_RPC_URL,
			networkPassphrase: config.networkPassphrase
		})
	);
	registerHubbleDatasetRoutes(router, config.warehouse);
	registerAssetRelatedRoutes(router, catalogue, (asset) =>
		assetMetadata(asset, metadata)
	);
	if (!config.catalogue) catalogue.start();
	router.get('/asset-logos/:filename', (request, response, next) => {
		if (
			!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(request.params.filename ?? '')
		) {
			response
				.status(404)
				.json({ code: 'logo_not_found', error: 'Logo not found' });
			return;
		}
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
		next();
	});
	router.use(
		'/asset-logos',
		express.static(metadata.getCachedLogoDirectory(), {
			immutable: true,
			maxAge: '365d',
			fallthrough: false
		})
	);
	router.get('/assets', async (request, response) =>
		send(response, async () =>
			assetPage(await catalogue.search(searchInput(request)), metadata)
		)
	);
	router.get('/issuers', async (request, response) =>
		send(response, () => issuerDirectory.search(issuerDirectoryInput(request)))
	);
	router.get('/assets/:assetRef/metadata', async (request, response) =>
		send(response, async () => {
			const asset = await catalogue.resolve(request.params.assetRef!);
			if (typeof asset === 'string')
				throw new AssetInputError(
					'Metadata requires CODE:ISSUER, native, or C address'
				);
			return { asset, metadata: await assetMetadata(asset, metadata) };
		})
	);
	router.get('/assets/:assetRef', async (request, response) =>
		send(response, async () => {
			const asset = await catalogue.resolve(request.params.assetRef!);
			if (typeof asset === 'string')
				return {
					matches: await assetPage(
						await catalogue.search({
							...searchInput(request),
							symbol: asset
						}),
						metadata
					)
				};
			const encoded = encodeURIComponent(asset.id);
			return {
				asset: { ...asset, observed: 'firstObservedLedger' in asset },
				metadata: await assetMetadata(asset, metadata),
				links: {
					self: '/v1/assets/' + encoded,
					metadata: '/v1/assets/' + encoded + '/metadata',
					issuer: asset.issuer ? '/v1/issuers/' + asset.issuer : null,
					contract: '/v1/contracts/' + asset.contractId,
					holders: '/v1/assets/' + encoded + '/holders',
					transfers: '/v1/assets/' + encoded + '/activity/transfers',
					explorer: '/explorer/assets/' + encoded
				}
			};
		})
	);
	router.get('/issuers/:issuer/assets', async (request, response) =>
		send(response, async () => {
			const issuer = requireIssuer(request.params.issuer);
			return assetPage(
				await catalogue.search({ ...searchInput(request), issuer }),
				metadata
			);
		})
	);
	router.get('/issuers/:issuer', async (request, response) =>
		send(response, async () => {
			const issuer = requireIssuer(request.params.issuer);
			const assets = await assetPage(
				await catalogue.search({
					...searchInput(request),
					issuer
				}),
				metadata
			);
			const info = await metadata.getIssuerMetadata(issuer);
			if (!info)
				void metadata
					.ensureIssuerMetadata(issuer)
					.catch((error) =>
						console.warn('Issuer metadata refresh failed', error)
					);
			return {
				issuer: { id: issuer, homeDomain: info?.homeDomain ?? null },
				metadata: info,
				assets,
				links: {
					assets: '/v1/issuers/' + issuer + '/assets',
					explorer: '/explorer/issuers/' + issuer
				}
			};
		})
	);
	// Object routes share the existing parsed-data services and avoid an analytics prefix.
	// Normalize asset aliases before the existing holder/transfer validators receive them.
	const resources = express.Router();
	const executor = () => {
		if (!config.warehouse.readModelExecutor)
			throw new HubbleWarehouseUnavailableError('Read models unavailable');
		return config.warehouse.readModelExecutor();
	};
	registerHubbleAssetSnapshotRoutes(resources, config.warehouse);
	registerHubbleAssetReportRoutes(resources, config.warehouse, executor);
	registerHubblePoolSnapshotRoutes(resources, config.warehouse, executor);
	registerHubbleContractEventRoutes(resources, config.warehouse);
	registerHubbleExplorerRoutes(resources, config.warehouse);
	registerHubbleSemanticRoutes(resources, config.warehouse);
	registerHubbleTransferRoutes(resources, config.warehouse);
	router.use('/assets/:asset', async (request, response, next) => {
		try {
			const value = await catalogue.resolve(request.params.asset!);
			if (typeof value === 'string')
				throw new AssetInputError(
					'Select an asset issuer before querying holders or transfers'
				);
			const previous = request.url;
			request.url = '/assets/' + encodeURIComponent(value.id) + previous;
			resources(request, response, (error?: unknown) => {
				request.url = previous;
				next(error);
			});
		} catch (error) {
			next(error);
		}
	});
	// Register complete paths directly; metadata/discovery definitions take precedence.
	router.use(resources);
	router.use(
		(
			error: unknown,
			_request: Request,
			response: Response,
			_next: express.NextFunction
		) => {
			if (
				_request.path.startsWith('/asset-logos/') &&
				typeof error === 'object' &&
				error !== null &&
				'status' in error &&
				error.status === 404
			) {
				response
					.status(404)
					.json({ code: 'logo_not_found', error: 'Logo not found' });
				return;
			}
			if (
				error instanceof AssetInputError ||
				(error instanceof Error &&
					/Invalid|requires|checksum|Use an asset|Select an asset/.test(
						error.message
					))
			)
				response.status(400).json({
					code: 'invalid_asset_request',
					error: (error as Error).message
				});
			else {
				console.error('Asset resource request failed', error);
				response.status(503).json({
					code: 'asset_resource_unavailable',
					error: 'Asset data is temporarily unavailable'
				});
			}
		}
	);
	return router;
}

async function assetPage(
	page: Record<string, unknown>,
	metadata: AssetMetadataService
) {
	const rows = Array.isArray(page.data) ? (page.data as AssetIdentity[]) : [];
	const data = await Promise.all(
		rows.map(async (asset) => {
			const info = await assetMetadata(asset, metadata);
			return {
				...asset,
				name: info.name,
				logoUrl: info.logoUrl,
				metadataStatus:
					info.status === 'ready' && info.logoStatus === 'pending'
						? 'pending'
						: info.status,
				logoStatus: info.logoStatus
			};
		})
	);
	return { ...page, data };
}

async function assetMetadata(
	asset: AssetIdentity,
	metadata: AssetMetadataService
) {
	if (asset.kind === 'native')
		return {
			status: 'ready' as const,
			name: 'Stellar Lumens',
			description: 'Native asset of the Stellar network.',
			homeDomain: null,
			tomlUrl: null,
			logoUrl: null,
			logoStatus: 'unavailable' as const,
			organization: null,
			fetchedAt: null,
			error: null
		};
	return metadata.getAssetMetadata({
		id: asset.id,
		code: asset.code ?? undefined,
		issuer: asset.issuer ?? undefined,
		contractId: asset.contractId
	});
}

function issuerDirectoryInput(request: Request): {
	q?: string;
	limit: number;
	cursor?: string;
} {
	const allowed = new Set(['q', 'limit', 'cursor']);
	for (const key of Object.keys(request.query))
		if (!allowed.has(key))
			throw new AssetInputError('Unsupported issuer filter: ' + key);
	const text = (key: string): string | undefined => {
		const value = request.query[key];
		if (value === undefined || value === '') return undefined;
		if (typeof value !== 'string' || value.length > 2048)
			throw new AssetInputError('Invalid ' + key);
		return value;
	};
	const limitText = text('limit');
	const limit = limitText === undefined ? 25 : Number(limitText);
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 100 ||
		(limitText !== undefined && !/^\d+$/.test(limitText))
	)
		throw new AssetInputError('Issuer limit must be between 1 and 100');
	return { q: text('q'), cursor: text('cursor'), limit };
}

function searchInput(request: Request): AssetSearch {
	const allowed = new Set([
		'q',
		'symbol',
		'issuer',
		'limit',
		'cursor',
		'min_ledger',
		'max_ledger',
		'start_time',
		'end_time'
	]);
	for (const key of Object.keys(request.query))
		if (!allowed.has(key))
			throw new AssetInputError('Unsupported asset filter: ' + key);
	const text = (key: string): string | undefined => {
		const value = request.query[key];
		if (value === undefined || value === '') return undefined;
		if (typeof value !== 'string' || value.length > 2048)
			throw new AssetInputError('Invalid ' + key);
		return value;
	};
	const integer = (key: string): number | undefined => {
		const value = text(key);
		if (!value) return undefined;
		if (!/^\d+$/.test(value)) throw new AssetInputError('Invalid ' + key);
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed) || parsed < 1)
			throw new AssetInputError('Invalid ' + key);
		return parsed;
	};
	const time = (key: string): string | undefined => {
		const value = text(key);
		if (!value) return undefined;
		const date = new Date(value);
		if (!Number.isFinite(date.getTime()))
			throw new AssetInputError('Invalid ' + key);
		return date.toISOString();
	};
	const limit = integer('limit') ?? 25;
	if (limit > 100)
		throw new AssetInputError('Asset limit must be between 1 and 100');
	const issuer = text('issuer');
	if (issuer) requireIssuer(issuer);
	const minLedger = integer('min_ledger'),
		maxLedger = integer('max_ledger'),
		startTime = time('start_time'),
		endTime = time('end_time');
	if (
		minLedger !== undefined &&
		maxLedger !== undefined &&
		minLedger > maxLedger
	)
		throw new AssetInputError('First ledger must precede last ledger');
	if (startTime && endTime && startTime >= endTime)
		throw new AssetInputError('From time must precede to time');
	return {
		q: text('q'),
		symbol: text('symbol'),
		issuer,
		limit,
		cursor: text('cursor'),
		minLedger,
		maxLedger,
		startTime,
		endTime
	};
}

function requireIssuer(value: string | undefined): string {
	if (!value || !StrKey.isValidEd25519PublicKey(value))
		throw new AssetInputError('Issuer must be a checksum-valid G address');
	return value;
}
class AssetInputError extends Error {}
async function send(
	response: Response,
	action: () => Promise<unknown>
): Promise<void> {
	try {
		const value = await action();
		response.setHeader(
			'Cache-Control',
			'public, max-age=15, stale-while-revalidate=60'
		);
		response.json(value);
	} catch (error) {
		if (
			error instanceof AssetInputError ||
			(error instanceof Error &&
				/Invalid|requires|checksum|Use an asset/.test(error.message))
		)
			response.status(400).json({
				code: 'invalid_asset_request',
				error: (error as Error).message
			});
		else {
			console.error('Asset resource request failed', error);
			response.status(503).json({
				code: 'asset_resource_unavailable',
				error: 'Asset data is temporarily unavailable'
			});
		}
	}
}
