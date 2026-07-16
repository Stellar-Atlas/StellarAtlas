import { Url, type HttpOptions, type HttpService } from 'http-helper';
import { err, ok, type Result } from 'neverthrow';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';
import type { HistoryArchiveWorkerStatusReporter } from '../../domain/scan/HistoryArchiveWorkerStatusReporter.js';
import type { CoordinatorAuthConfig } from '../config/CoordinatorAuthConfig.js';
import { CoordinatorServiceError } from './CoordinatorServiceError.js';

const coordinatorWriteOptions: HttpOptions = {
	connectionTimeoutMs: 5_000,
	socketTimeoutMs: 5_000
};

export class RESTHistoryArchiveWorkerStatusReporter implements HistoryArchiveWorkerStatusReporter {
	constructor(
		private readonly httpService: HttpService,
		private readonly coordinatorAPIBaseUrl: string,
		private readonly coordinatorAuth: CoordinatorAuthConfig
	) {}

	async report(
		status: HistoryArchiveWorkerReportDTO
	): Promise<Result<void, Error>> {
		const urlResult = Url.create(
			`${this.coordinatorAPIBaseUrl}/v1/history-scan/worker-status`
		);
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			{ ...status },
			this.getHttpOptions()
		);
		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(
					'Failed to report archive worker status',
					response.error
				)
			);
		}
		if (response.value.status !== 204) {
			return err(
				new CoordinatorServiceError('Failed to report archive worker status')
			);
		}

		return ok(undefined);
	}

	private getHttpOptions(): HttpOptions {
		if (this.coordinatorAuth.type === 'community') {
			return {
				...coordinatorWriteOptions,
				headers: {
					Authorization: `Bearer ${this.coordinatorAuth.apiKey}`
				}
			};
		}

		return {
			...coordinatorWriteOptions,
			auth: {
				username: this.coordinatorAuth.username,
				password: this.coordinatorAuth.password
			}
		};
	}
}
