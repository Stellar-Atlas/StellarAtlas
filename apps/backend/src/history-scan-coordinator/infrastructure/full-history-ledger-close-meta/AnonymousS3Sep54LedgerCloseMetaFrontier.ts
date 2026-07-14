import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { FullHistoryLedgerCloseMetaFrontierPort } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import type { FullHistoryLedgerCloseMetaRange } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { Sep54LedgerCloseMetaConfig } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import {
	createSep54LedgerCloseMetaConfigObjectKey,
	parseSep54LedgerCloseMetaObjectKey
} from './Sep54LedgerCloseMetaObjectKey.js';

const maximumKeysPerPage = 32;
const maximumListPages = 4;

export interface AnonymousS3Sep54LedgerCloseMetaFrontierOptions {
	readonly bucket: string;
	readonly client?: AnonymousS3ListObjectsClient;
	readonly ledgersPath: string;
	readonly region: string;
}

export interface AnonymousS3ListObjectsClient {
	list(
		request: AnonymousS3ListObjectsRequest,
		signal: AbortSignal
	): Promise<AnonymousS3ListObjectsResult>;
	destroy(): void;
}

export interface AnonymousS3ListObjectsRequest {
	readonly bucket: string;
	readonly continuationToken?: string;
	readonly maximumKeys: number;
	readonly prefix: string;
}

export interface AnonymousS3ListObjectsResult {
	readonly keys: readonly string[];
	readonly nextContinuationToken?: string;
}

export class AnonymousS3Sep54LedgerCloseMetaFrontier implements FullHistoryLedgerCloseMetaFrontierPort {
	readonly #bucket: string;
	readonly #client: AnonymousS3ListObjectsClient;
	readonly #ledgersPath: string;

	constructor(options: AnonymousS3Sep54LedgerCloseMetaFrontierOptions) {
		this.#bucket = boundedName(options.bucket, 'bucket');
		boundedName(options.region, 'region');
		const configKey = createSep54LedgerCloseMetaConfigObjectKey(
			options.ledgersPath
		);
		this.#ledgersPath = configKey.endsWith('/.config.json')
			? configKey.slice(0, -'/.config.json'.length)
			: '';
		this.#client =
			options.client ?? new AwsSdkAnonymousS3ListObjectsClient(options.region);
	}

	destroy(): void {
		this.#client.destroy();
	}

	async readLatestRange(
		config: Sep54LedgerCloseMetaConfig,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaRange> {
		let continuationToken: string | undefined;
		for (let page = 0; page < maximumListPages; page += 1) {
			signal.throwIfAborted();
			const result = await this.#client.list(
				{
					bucket: this.#bucket,
					continuationToken,
					maximumKeys: maximumKeysPerPage,
					prefix: `${this.#ledgersPath}/`
				},
				signal
			);
			const newest = newestRange(config, result.keys, this.#ledgersPath);
			if (newest !== null) return newest;
			continuationToken = result.nextContinuationToken;
			if (continuationToken === undefined) break;
		}
		throw new Error('SEP-54 S3 source did not list a ledger batch');
	}
}

class AwsSdkAnonymousS3ListObjectsClient implements AnonymousS3ListObjectsClient {
	readonly #client: S3Client;

	constructor(region: string) {
		this.#client = new S3Client({
			credentials: {
				accessKeyId: 'anonymous',
				secretAccessKey: 'anonymous'
			},
			region,
			signer: { sign: async (request) => request }
		});
	}

	destroy(): void {
		this.#client.destroy();
	}

	async list(
		request: AnonymousS3ListObjectsRequest,
		signal: AbortSignal
	): Promise<AnonymousS3ListObjectsResult> {
		const response = await this.#client.send(
			new ListObjectsV2Command({
				Bucket: request.bucket,
				ContinuationToken: request.continuationToken,
				MaxKeys: request.maximumKeys,
				Prefix: request.prefix
			}),
			{ abortSignal: signal }
		);
		const keys = (response.Contents ?? []).flatMap((object) =>
			typeof object.Key === 'string' ? [object.Key] : []
		);
		return Object.freeze({
			keys: Object.freeze(keys),
			nextContinuationToken: response.NextContinuationToken
		});
	}
}

function newestRange(
	config: Sep54LedgerCloseMetaConfig,
	keys: readonly string[],
	ledgersPath: string
): FullHistoryLedgerCloseMetaRange | null {
	let newest: FullHistoryLedgerCloseMetaRange | null = null;
	for (const key of keys) {
		if (!key.endsWith('.xdr.zst')) continue;
		let range: FullHistoryLedgerCloseMetaRange;
		try {
			range = parseSep54LedgerCloseMetaObjectKey(
				config,
				key,
				ledgersPath
			).range;
		} catch (error) {
			throw invalidListedKey(key, error);
		}
		if (newest === null || range.endSequence > newest.endSequence) {
			newest = range;
		}
	}
	return newest;
}

function invalidListedKey(key: string, cause: unknown): Error {
	return new Error(`SEP-54 S3 source listed an invalid ledger key: ${key}`, {
		cause
	});
}

function boundedName(value: string, field: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(value)) {
		throw new TypeError(`${field} is invalid`);
	}
	return value;
}
