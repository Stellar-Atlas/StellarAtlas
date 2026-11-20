import axios, { AxiosError, AxiosResponse } from 'axios';
import {
	EmailRateLimitError,
	WeeklyEmailGate
} from 'shared/lib/email/WeeklyEmailGate.js';

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
		protected baseUrl: string,
		private readonly emailGate: WeeklyEmailGate
	) {}

	async sendMessage(
		to: string,
		message: string,
		subject: string,
		userId: string
	): Promise<HttpResponse | HttpError> {
		const recipientKey = `subscriber:${userId.toLowerCase()}`;
		let attemptToken: string;
		try {
			if (!userId) throw new Error('Missing subscriber identity');
			attemptToken = await this.emailGate.reserve(recipientKey);
		} catch (error) {
			return error instanceof EmailRateLimitError
				? new HttpError('Weekly email limit reached', 'EMAIL_RATE_LIMIT', {
						status: 429
					})
				: new HttpError('Email gate unavailable', 'EMAIL_GATE_UNAVAILABLE');
		}
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
				new URLSearchParams({
					from: this.from,
					to,
					subject,
					html: message
				}).toString(),
				config
			);
			clearTimeout(timeout);
			return this.mapAxiosResponseToHttpResponse(axiosResponse);
		} catch (error) {
			if (timeout) clearTimeout(timeout);
			if (axios.isAxiosError(error)) {
				const status = error.response?.status;
				// A timeout response (408), server failure or transport error can be
				// ambiguous. Only explicit request/auth/recipient refusals release.
				if (
					status !== undefined &&
					[400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status)
				) {
					try {
						await this.emailGate.releaseRejected(recipientKey, attemptToken);
					} catch {
						return new HttpError(
							'Email gate unavailable',
							'EMAIL_GATE_UNAVAILABLE'
						);
					}
				}
				return this.mapAxiosErrorToHttpError(error);
			}
			return new HttpError(
				'Mail provider request failed',
				'PROVIDER_TRANSPORT'
			);
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
			return new HttpError(
				'Mail provider rejected the request',
				'PROVIDER_HTTP',
				{
					status: axiosError.response.status
				}
			);
		}
		if (
			axiosError.code === AxiosError.ECONNABORTED ||
			axiosError.code === AxiosError.ETIMEDOUT ||
			axiosError.code === AxiosError.ERR_CANCELED
		) {
			return new HttpError(
				'Mail provider request timed out',
				'PROVIDER_TIMEOUT'
			);
		}
		return new HttpError('Mail provider request failed', 'PROVIDER_TRANSPORT');
	}
}
