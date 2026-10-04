import { Url, type HttpService } from 'http-helper';

/** Reuse the worker's bounded keep-alive HTTP client for optional listing probes. */
export function archiveListingFetch(httpService: HttpService): typeof fetch {
	return async (input, options) => {
		const rawUrl =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const url = Url.create(rawUrl);
		if (url.isErr()) throw url.error;
		const result = await httpService.get(url.value, {
			responseType: 'arraybuffer',
			requestTimeoutMs: 5_000,
			socketTimeoutMs: 5_000,
			maxContentLength: 65_536,
			maxRedirects: 0,
			...(options?.signal == null ? {} : { abortSignal: options.signal })
		});
		const response = result.isOk() ? result.value : result.error.response;
		if (!response)
			throw result.isErr() ? result.error : new Error('No listing response');
		const data: unknown = response.data;
		const body =
			typeof data === 'string'
				? data
				: data instanceof Uint8Array
					? new Uint8Array(data)
					: data instanceof ArrayBuffer
						? new Uint8Array(data)
						: '';
		return new Response(body, { status: response.status });
	};
}
