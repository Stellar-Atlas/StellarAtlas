import { err, ok, Result } from 'neverthrow';
import * as toml from 'toml';
import { queue } from 'async';
import { isObject, isString } from 'shared';
import { inject, injectable } from 'inversify';
import 'reflect-metadata';
import { HttpError, type HttpService } from 'http-helper';
import { Url, retryHttpRequestIfNeeded } from 'http-helper';
import type { HttpResponse } from 'http-helper';
import type { Logger } from 'logger';
import { mapUnknownToError } from 'shared';
import { CustomError } from 'custom-error';
import * as https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export const STELLAR_TOML_MAX_SIZE = 100 * 1024;
const TOML_FETCH_CONCURRENCY = 24;
const TOML_FETCH_RETRIES = 2;
const TOML_FETCH_RETRY_SLEEP_MS = 300;
const TOML_FETCH_TIMEOUT_MS = 2500;
const TOML_MAX_REDIRECTS = 5;
export const TOML_TLS_CERTIFICATE_WARNING =
	'TlsCertificateVerificationDisabled';
export type TomlFetchWarning = typeof TOML_TLS_CERTIFICATE_WARNING;
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
	constructor(
		public cause: Error,
		public readonly tomlText: string | null = null
	) {
		super('Failed to parse toml', TomlParseError.name, cause);
	}
}

export interface TomlFetchSuccess {
	authoritative: boolean;
	tomlObject: Record<string, unknown>;
	tomlText: string;
	warnings: TomlFetchWarning[];
}

interface TomlFileFetchSuccess {
	response: HttpResponse;
	warnings: TomlFetchWarning[];
}

interface TomlFileFetchError {
	cause: HttpError;
	warnings: TomlFetchWarning[];
}

export class TomlFetchError extends CustomError {
	constructor(
		public domain: string,
		public cause: HttpError | TomlParseError,
		public readonly tomlText: string | null = null,
		public readonly warnings: TomlFetchWarning[] = []
	) {
		super('Fetch toml failed for ' + domain, TomlFetchError.name, cause);
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
	): Promise<Map<string, TomlFetchSuccess | TomlFetchError>> {
		const tomlObjects = new Map<string, TomlFetchSuccess | TomlFetchError>();
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
	): Promise<Result<TomlFetchSuccess, TomlFetchError>> {
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
			return err(
				new TomlFetchError(
					homeDomain,
					tomlFileResponse.error.cause,
					null,
					tomlFileResponse.error.warnings
				)
			);
		}

		return this.parseTomlResponse(
			homeDomain,
			tomlFileResponse.value.response,
			tomlFileResponse.value.warnings
		);
	}

	private async fetchTomlFile(
		homeDomain: string,
		url: Url
	): Promise<Result<TomlFileFetchSuccess, TomlFileFetchError>> {
		const secureHttpsAgent = new https.Agent({
			lookup: publicTomlAddressLookup
		});
		let insecureHttpsAgent: https.Agent | null = null;
		let currentUrl = url;
		const warnings: TomlFetchWarning[] = [];
		try {
			for (
				let redirectCount = 0;
				redirectCount <= TOML_MAX_REDIRECTS;
				redirectCount++
			) {
				const endpointError = validateTomlEndpoint(currentUrl);
				if (endpointError !== null) {
					return err({ cause: endpointError, warnings: [...warnings] });
				}

				let response = await this.fetchTomlWithOptions(currentUrl, {
					httpsAgent: secureHttpsAgent
				});
				const secureRedirect = getRedirectTarget(currentUrl, response);
				if (secureRedirect.isErr()) {
					return err({ cause: secureRedirect.error, warnings: [...warnings] });
				}
				if (secureRedirect.value !== null) {
					currentUrl = secureRedirect.value;
					continue;
				}
				if (response.isOk()) {
					return ok({ response: response.value, warnings: [...warnings] });
				}
				if (!TomlService.isTlsCertificateError(response.error)) {
					return err({ cause: response.error, warnings: [...warnings] });
				}

				this.logger.info(
					'Retrying stellar.toml with TLS certificate verification disabled',
					{
						code: response.error.code,
						domain: homeDomain,
						error: response.error.message
					}
				);
				insecureHttpsAgent ??= new https.Agent({
					lookup: publicTomlAddressLookup,
					rejectUnauthorized: false
				});
				response = await this.fetchTomlWithOptions(currentUrl, {
					httpsAgent: insecureHttpsAgent
				});
				if (!warnings.includes(TOML_TLS_CERTIFICATE_WARNING)) {
					warnings.push(TOML_TLS_CERTIFICATE_WARNING);
				}
				const insecureRedirect = getRedirectTarget(currentUrl, response);
				if (insecureRedirect.isErr()) {
					return err({
						cause: insecureRedirect.error,
						warnings: [...warnings]
					});
				}
				if (insecureRedirect.value !== null) {
					currentUrl = insecureRedirect.value;
					continue;
				}
				if (response.isOk()) {
					this.logger.info(
						'Fetched stellar.toml despite TLS certificate error',
						{
							domain: homeDomain
						}
					);
					return ok({ response: response.value, warnings: [...warnings] });
				}
				return err({ cause: response.error, warnings: [...warnings] });
			}

			return err({
				cause: new HttpError(
					`Too many stellar.toml redirects for ${homeDomain}`,
					'TOML_REDIRECT_LIMIT'
				),
				warnings: [...warnings]
			});
		} finally {
			secureHttpsAgent.destroy();
			insecureHttpsAgent?.destroy();
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
				maxRedirects: 0,
				proxy: false,
				maxContentLength: STELLAR_TOML_MAX_SIZE,
				socketTimeoutMs: TOML_FETCH_TIMEOUT_MS,
				connectionTimeoutMs: TOML_FETCH_TIMEOUT_MS
			}
		);
	}

	private parseTomlResponse(
		homeDomain: string,
		tomlFileResponse: HttpResponse,
		warnings: TomlFetchWarning[]
	): Result<TomlFetchSuccess, TomlFetchError> {
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

			return ok({
				authoritative: warnings.length === 0,
				tomlObject,
				tomlText: tomlFileResponse.data,
				warnings
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			return err(
				new TomlFetchError(
					homeDomain,
					new TomlParseError(error, tomlFileResponse.data),
					tomlFileResponse.data,
					warnings
				)
			);
		}
	}

	private static isTlsCertificateError(error: HttpError): boolean {
		if (error.response !== undefined) return false;
		if (error.code && tlsCertificateErrorCodes.has(error.code)) return true;
		return /certificate|self[- ]signed|tls/i.test(error.message);
	}
}

const blockedTomlAddresses = createBlockedTomlAddressList();

function createBlockedTomlAddressList(): BlockList {
	const blocked = new BlockList();
	for (const [address, prefix] of [
		['0.0.0.0', 8],
		['10.0.0.0', 8],
		['100.64.0.0', 10],
		['127.0.0.0', 8],
		['169.254.0.0', 16],
		['172.16.0.0', 12],
		['192.0.0.0', 24],
		['192.0.2.0', 24],
		['192.88.99.0', 24],
		['192.168.0.0', 16],
		['198.18.0.0', 15],
		['198.51.100.0', 24],
		['203.0.113.0', 24],
		['224.0.0.0', 4],
		['240.0.0.0', 4]
	] as const) {
		blocked.addSubnet(address, prefix, 'ipv4');
	}
	for (const [address, prefix] of [
		['::', 128],
		['::1', 128],
		['100::', 64],
		['2001:2::', 48],
		['2001:db8::', 32],
		['2001:10::', 28],
		['fc00::', 7],
		['fe80::', 10],
		['fec0::', 10],
		['ff00::', 8]
	] as const) {
		blocked.addSubnet(address, prefix, 'ipv6');
	}
	return blocked;
}

export function isPublicTomlAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return !blockedTomlAddresses.check(address, 'ipv4');
	if (family === 6) return !blockedTomlAddresses.check(address, 'ipv6');
	return false;
}

export const publicTomlAddressLookup: LookupFunction = (
	hostname,
	options,
	callback
) => {
	dnsLookup(
		hostname,
		{
			all: true,
			family: options.family,
			hints: options.hints,
			verbatim: true
		},
		(error, addresses) => {
			if (error) {
				callback(error, '');
				return;
			}
			if (
				addresses.length === 0 ||
				addresses.some((address) => !isPublicTomlAddress(address.address))
			) {
				callback(createPrivateAddressError(hostname), '');
				return;
			}

			if (options.all) {
				callback(null, addresses);
				return;
			}
			const selected = addresses[0];
			if (selected === undefined) {
				callback(createPrivateAddressError(hostname), '');
				return;
			}
			callback(null, selected.address, selected.family);
		}
	);
};

function createPrivateAddressError(hostname: string): NodeJS.ErrnoException {
	const error = new Error(
		`Refusing stellar.toml endpoint with a non-public address: ${hostname}`
	) as NodeJS.ErrnoException;
	error.code = 'TOML_PRIVATE_ADDRESS';
	return error;
}

function validateTomlEndpoint(url: Url): HttpError | null {
	let parsed: URL;
	try {
		parsed = new URL(url.value);
	} catch {
		return new HttpError('Invalid stellar.toml endpoint', 'TOML_INVALID_URL');
	}
	if (
		parsed.protocol !== 'https:' ||
		parsed.username !== '' ||
		parsed.password !== '' ||
		(parsed.port !== '' && parsed.port !== '443')
	) {
		return new HttpError(
			'Refusing unsafe stellar.toml endpoint',
			'TOML_UNSAFE_URL'
		);
	}

	const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
	if (isIP(hostname) !== 0 && !isPublicTomlAddress(hostname)) {
		return new HttpError(
			`Refusing stellar.toml endpoint with a non-public address: ${hostname}`,
			'TOML_PRIVATE_ADDRESS'
		);
	}
	return null;
}

function getRedirectTarget(
	currentUrl: Url,
	result: Result<HttpResponse, HttpError>
): Result<Url | null, HttpError> {
	const response = result.isOk() ? result.value : result.error.response;
	if (
		response === undefined ||
		typeof response.status !== 'number' ||
		response.status < 300 ||
		response.status >= 400
	) {
		return ok(null);
	}

	const location = getHeader(response.headers, 'location');
	if (location === null) {
		return err(
			new HttpError('stellar.toml redirect omitted Location', 'TOML_REDIRECT')
		);
	}
	let target: URL;
	try {
		target = new URL(location, currentUrl.value);
	} catch {
		return err(new HttpError('Invalid stellar.toml redirect', 'TOML_REDIRECT'));
	}
	const targetResult = Url.create(target.toString());
	if (targetResult.isErr()) {
		return err(new HttpError(targetResult.error.message, 'TOML_REDIRECT'));
	}
	const endpointError = validateTomlEndpoint(targetResult.value);
	if (endpointError !== null) return err(endpointError);
	return ok(targetResult.value);
}

function getHeader(headers: unknown, name: string): string | null {
	if (!isObject(headers)) return null;
	const getter = headers.get;
	if (typeof getter === 'function') {
		const value: unknown = getter.call(headers, name);
		if (typeof value === 'string') return value;
	}
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
	return null;
}
