import { Url, type HttpOptions, type HttpService } from 'http-helper';
import { err, ok, type Result } from 'neverthrow';
import {
	isHistoryArchiveReusableContentV1,
	type HistoryArchiveContentReuseRequestV1,
	type HistoryArchiveReusableContentV1
} from 'shared';
import type { CoordinatorAuthConfig } from '../config/CoordinatorAuthConfig.js';
import { CoordinatorServiceError } from './CoordinatorServiceError.js';

const lookupOptions: HttpOptions = {
	connectionTimeoutMs: 2_000,
	responseType: 'json',
	socketTimeoutMs: 2_000
};

export async function requestReusableHistoryArchiveContent(
	httpService: HttpService,
	coordinatorAPIBaseUrl: string,
	coordinatorAuth: CoordinatorAuthConfig,
	request: HistoryArchiveContentReuseRequestV1
): Promise<Result<HistoryArchiveReusableContentV1 | null, Error>> {
	if (coordinatorAuth.type === 'community') return ok(null);
	const urlResult = Url.create(
		`${coordinatorAPIBaseUrl}/v1/history-scan/archive-content/reuse`
	);
	if (urlResult.isErr()) {
		return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
	}
	const response = await httpService.post(
		urlResult.value,
		request as unknown as Record<string, unknown>,
		{
			...lookupOptions,
			auth: {
				password: coordinatorAuth.password,
				username: coordinatorAuth.username
			}
		}
	);
	if (response.isErr()) {
		return err(
			new CoordinatorServiceError(
				'Failed to look up reusable archive content',
				response.error
			)
		);
	}
	if (response.value.status === 204) return ok(null);
	if (
		response.value.status !== 200 ||
		!isHistoryArchiveReusableContentV1(response.value.data)
	) {
		return err(
			new CoordinatorServiceError('Invalid reusable archive content response')
		);
	}
	return ok(response.value.data);
}
