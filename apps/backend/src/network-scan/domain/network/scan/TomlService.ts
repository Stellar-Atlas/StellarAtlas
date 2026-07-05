import { err, ok, Result } from 'neverthrow';
import * as toml from 'toml';
import { queue } from 'async';
import { isString } from 'shared';
import { inject, injectable } from 'inversify';
import 'reflect-metadata';
import { HttpError, type HttpService } from 'http-helper';
import { Url, retryHttpRequestIfNeeded } from 'http-helper';
import type { HttpResponse } from 'http-helper';
import type { Logger } from 'logger';
import { mapUnknownToError } from 'shared';
import { CustomError } from 'custom-error';
import * as https from 'node:https';

export const STELLAR_TOML_MAX_SIZE = 100 * 1024;
const TOML_FETCH_CONCURRENCY = 24;
const TOML_FETCH_RETRIES = 2;
const TOML_FETCH_RETRY_SLEEP_MS = 300;
const TOML_FETCH_TIMEOUT_MS = 2500;
const tlsCertificateErrorCodes = new Set([
	'CERT_HAS_EXPIRED',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'ERR_TLS_CERT_ALTNAME_INVALID',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'UNABLE_TO_GET_ISSUER_CERT',
	'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);

export class TomlParseError extends CustomError {
	constructor(public cause: Error) {
		super('Failed to parse toml', TomlParseError.name, cause);
	}
}

export class TomlFetchError {
	public message: string;
	constructor(
		public domain: string,
		public cause: HttpError | TomlParseError
	) {
		this.message = 'Fetch toml failed for ' + domain;
	}
}

@injectable()
export class TomlService {
	constructor(
		@inject('HttpService') protected httpService: HttpService,
		@inject('Logger') protected logger: Logger
	) {}

	async fetchTomlObjects(
		domains: string[] = []
	): Promise<Map<string, Record<string, unknown> | TomlFetchError>> {
		const tomlObjects = new Map<
			string,
			Record<string, unknown> | TomlFetchError
		>();
		if (domains.length === 0) return tomlObjects;

		const startTime = Date.now();
		const uniqueDomains = Array.from(new Set(domains));
		this.logger.info('Fetching stellar.toml files', {
			domains: uniqueDomains.length,
			concurrency: TOML_FETCH_CONCURRENCY,
			timeoutMs: TOML_FETCH_TIMEOUT_MS,
			retries: TOML_FETCH_RETRIES
		});

		const q = queue(async (domain: string, callback) => {
			const tomlObjectResult = await this.fetchToml(domain);
			if (tomlObjectResult.isOk()) {
				this.logger.debug('Fetched toml for ' + domain + ' successfully');
				tomlObjects.set(domain, tomlObjectResult.value);
			} else {
				tomlObjects.set(domain, tomlObjectResult.error);
				this.logger.info('Failed to fetch toml for ' + domain, {
					error: mapUnknownToError(tomlObjectResult.error).message
				});
			}
			callback();
		}, TOML_FETCH_CONCURRENCY);

		uniqueDomains.forEach((domain) => q.push(domain));
		await q.drain();

		this.logger.info('Fetched stellar.toml files', {
			domains: uniqueDomains.length,
			successes: Array.from(tomlObjects.values()).filter(
				(value) => !(value instanceof TomlFetchError)
			).length,
			failures: Array.from(tomlObjects.values()).filter(
				(value) => value instanceof TomlFetchError
			).length,
			durationMs: Date.now() - startTime
		});

		return tomlObjects;
	}

	async fetchToml(
		homeDomain: string
	): Promise<Result<Record<string, unknown>, TomlFetchError>> {
		const urlResult = Url.create(
			'https://' + homeDomain + '/.well-known/stellar.toml'
		);
		if (urlResult.isErr())
			throw new Error('invalid home domain: ' + homeDomain);

		const tomlFileResponse = await this.fetchTomlFile(
			homeDomain,
			urlResult.value
		);

		if (tomlFileResponse.isErr()) {
			return err(new TomlFetchError(homeDomain, tomlFileResponse.error));
		}

		return this.parseTomlResponse(homeDomain, tomlFileResponse.value);
	}

	private async fetchTomlFile(
		homeDomain: string,
		url: Url
	): Promise<Result<HttpResponse, HttpError>> {
		const tomlFileResponse = await this.fetchTomlWithOptions(url);
		if (
			tomlFileResponse.isOk() ||
			!TomlService.isTlsCertificateError(tomlFileResponse.error)
		) {
			return tomlFileResponse;
		}

		this.logger.info(
			'Retrying stellar.toml with TLS certificate verification disabled',
			{
				code: tomlFileResponse.error.code,
				domain: homeDomain,
				error: tomlFileResponse.error.message
			}
		);
		const insecureHttpsAgent = new https.Agent({
			rejectUnauthorized: false
		});
		try {
			const insecureTomlFileResponse = await this.fetchTomlWithOptions(url, {
				httpsAgent: insecureHttpsAgent
			});
			if (insecureTomlFileResponse.isOk()) {
				this.logger.info('Fetched stellar.toml despite TLS certificate error', {
					code: tomlFileResponse.error.code,
					domain: homeDomain,
					error: tomlFileResponse.error.message
				});
			}
			return insecureTomlFileResponse;
		} finally {
			insecureHttpsAgent.destroy();
		}
	}

	private async fetchTomlWithOptions(
		url: Url,
		options: { httpsAgent?: https.Agent } = {}
	): Promise<Result<HttpResponse, HttpError>> {
		return await retryHttpRequestIfNeeded(
			TOML_FETCH_RETRIES,
			TOML_FETCH_RETRY_SLEEP_MS,
			this.httpService.get.bind(this.httpService),
			url,
			{
				httpsAgent: options.httpsAgent,
				maxContentLength: STELLAR_TOML_MAX_SIZE,
				socketTimeoutMs: TOML_FETCH_TIMEOUT_MS,
				connectionTimeoutMs: TOML_FETCH_TIMEOUT_MS
			}
		);
	}

	private parseTomlResponse(
		homeDomain: string,
		tomlFileResponse: HttpResponse
	): Result<Record<string, unknown>, TomlFetchError> {
		if (!isString(tomlFileResponse.data))
			return err(
				new TomlFetchError(
					homeDomain,
					new TomlParseError(new Error('Invalid data type'))
				)
			);
		try {
			const tomlObject = toml.parse(tomlFileResponse.data);
			tomlObject.domain = homeDomain; //todo: return map of domain to toml instead of creating this property

			return ok(tomlObject);
		} catch (e) {
			const error = mapUnknownToError(e);
			return err(new TomlFetchError(homeDomain, new TomlParseError(error)));
		}
	}

	private static isTlsCertificateError(error: HttpError): boolean {
		if (error.response !== undefined) return false;
		if (error.code && tlsCertificateErrorCodes.has(error.code)) return true;
		return /certificate|self[- ]signed|tls/i.test(error.message);
	}
}
