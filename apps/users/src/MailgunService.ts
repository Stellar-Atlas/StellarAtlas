import axios, { AxiosError, AxiosResponse } from 'axios';

export function isHttpError(payload: unknown): payload is HttpError {
	return payload instanceof HttpError;
}

export type HttpResponse<T = unknown> = {
	data: T;
	status: number;
	statusText: string;
	headers: unknown;
};

export class HttpError extends Error {
	code?: string;
	response?: { status: number };
	constructor(message?: string, code?: string, response?: { status: number }) {
		super(message);
		this.code = code;
		this.response = response;
		this.name = 'HttpError';
	}
}

export class MailgunService {
	constructor(
		protected secret: string,
		protected from: string,
		protected baseUrl: string
	) {}

	async sendMessage(
		to: string,
		message: string,
		subject: string
	): Promise<HttpResponse | HttpError> {
		let timeout: NodeJS.Timeout | undefined;
		try {
			const source = axios.CancelToken.source();
			timeout = setTimeout(() => {
				source.cancel('Connection time-out');
			}, 2050);

			const config: Record<string, unknown> = {
				cancelToken: source.token,
				timeout: 2000,
				auth: {
					username: 'api',
					password: this.secret
				},
				headers: { 'content-type': 'application/x-www-form-urlencoded' }
			};

			const axiosResponse = await axios.post(
				this.baseUrl + '/messages',
				new URLSearchParams({ from: this.from, to, subject, html: message }).toString(),
				config
			);
			clearTimeout(timeout);
			return this.mapAxiosResponseToHttpResponse(axiosResponse);
		} catch (error) {
			if (timeout) clearTimeout(timeout);
			if (axios.isAxiosError(error)) {
				return this.mapAxiosErrorToHttpError(error);
			}
			return new HttpError('Mail provider request failed', 'PROVIDER_TRANSPORT');
		}
	}

	protected mapAxiosResponseToHttpResponse(
		axiosResponse: AxiosResponse
	): HttpResponse {
		return {
			data: axiosResponse.data,
			status: axiosResponse.status,
			statusText: axiosResponse.statusText,
			headers: axiosResponse.headers
		};
	}
	protected mapAxiosErrorToHttpError(axiosError: AxiosError): HttpError {
		if (axiosError.response) {
			return new HttpError('Mail provider rejected the request', 'PROVIDER_HTTP', {
				status: axiosError.response.status
			});
		}
		if (
			axiosError.code === AxiosError.ECONNABORTED ||
			axiosError.code === AxiosError.ETIMEDOUT ||
			axiosError.code === AxiosError.ERR_CANCELED
		) {
			return new HttpError('Mail provider request timed out', 'PROVIDER_TIMEOUT');
		}
		return new HttpError('Mail provider request failed', 'PROVIDER_TRANSPORT');
	}
}
