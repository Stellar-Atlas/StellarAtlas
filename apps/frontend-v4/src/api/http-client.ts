import type { ApiFailure } from './types';

const DEFAULT_API_BASE_URL = 'http://localhost:3000';
const DEFAULT_REVALIDATE_SECONDS = 10;

export class ApiClientError extends Error {
	readonly statusCode?: number;

	constructor(failure: ApiFailure) {
		super(failure.message);
		this.name = 'ApiClientError';
		this.statusCode = failure.statusCode;
	}
}

export interface FetchOptions {
	at?: Date;
	cache?: 'no-store';
	revalidate?: number;
	tags?: string[];
	timeoutMs?: number;
}

export interface NextFetchInit extends RequestInit {
	next?: {
		revalidate?: number;
		tags?: string[];
	};
}

export const getApiBaseUrl = (): string => {
	const configuredUrl = process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim();
	const baseUrl =
		configuredUrl && configuredUrl.length > 0
			? configuredUrl
			: DEFAULT_API_BASE_URL;

	return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

export const buildFetchInit = (options: FetchOptions = {}): NextFetchInit => {
	const init: NextFetchInit = {
		headers: {
			Accept: 'application/json'
		}
	};

	if (options.cache === 'no-store') {
		return {
			...init,
			cache: 'no-store'
		};
	}

	return {
		...init,
		next: {
			revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
			tags: options.tags
		}
	};
};

export const fetchJson = async <Payload>(
	path: string,
	options: FetchOptions = {}
): Promise<Payload> => {
	const timedFetch = buildTimedFetchInit(options);
	try {
		const response = await fetch(buildApiUrl(path, options), timedFetch.init);
		if (!response.ok) {
			throw new ApiClientError({
				message: `API request returned HTTP ${response.status}`,
				statusCode: response.status
			});
		}

		return (await response.json()) as Payload;
	} finally {
		timedFetch.cancel();
	}
};

export const fetchNullableJson = async <Payload>(
	path: string,
	options: FetchOptions = {}
): Promise<Payload | null> => {
	const timedFetch = buildTimedFetchInit(options);
	try {
		const response = await fetch(buildApiUrl(path, options), timedFetch.init);
		if (response.status === 204) return null;
		if (!response.ok) {
			throw new ApiClientError({
				message: `API request returned HTTP ${response.status}`,
				statusCode: response.status
			});
		}

		return (await response.json()) as Payload;
	} finally {
		timedFetch.cancel();
	}
};

const buildApiUrl = (path: string, options: FetchOptions = {}): string => {
	const url = new URL(`${getApiBaseUrl()}${path}`);

	if (options.at) {
		url.searchParams.set('at', options.at.toISOString());
	}

	return url.toString();
};

function buildTimedFetchInit(options: FetchOptions): {
	readonly cancel: () => void;
	readonly init: NextFetchInit;
} {
	const init = buildFetchInit(options);
	if (options.timeoutMs === undefined) {
		return { cancel: noop, init };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	return {
		cancel: () => clearTimeout(timer),
		init: {
			...init,
			signal: controller.signal
		}
	};
}

function noop(): void {}
