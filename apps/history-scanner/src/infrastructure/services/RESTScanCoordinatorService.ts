import 'reflect-metadata';
import {
	Url,
	isHttpError,
	type HttpOptions,
	type HttpService
} from 'http-helper';
import { injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { Scan } from '../../domain/scan/Scan.js';
import {
	ParsedLedgerHeaderBatchDTO,
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO,
	ScanJobDTO,
	type ScanJobJSONInput
} from 'history-scanner-dto';
import { ScanCoordinatorService } from '../../domain/scan/ScanCoordinatorService.js';
import type {
	HistoryArchiveObjectCompletionDTO,
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO,
	HistoryArchiveObjectProgressDTO,
	ScanJobProgressDTO
} from '../../domain/scan/ScanCoordinatorService.js';
import {
	isObject,
	type HistoryArchiveContentReuseRequestV1,
	type HistoryArchiveReusableContentV1
} from 'shared';
import type { CoordinatorAuthConfig } from '../config/CoordinatorAuthConfig.js';
import { CoordinatorServiceError } from './CoordinatorServiceError.js';
import { parseHistoryArchiveObjectJobDTO } from './HistoryArchiveObjectJobResponseParser.js';
import { mapParsedHistoryRegistrationResponse } from './ParsedHistoryRegistrationConflictError.js';
import { requestReusableHistoryArchiveContent } from './HistoryArchiveContentReuseClient.js';
import { mapScanToDTO } from './ScanDtoMapper.js';

const coordinatorReadOptions: HttpOptions = {
	connectionTimeoutMs: 30_000,
	socketTimeoutMs: 30_000
};
const coordinatorWriteOptions: HttpOptions = {
	connectionTimeoutMs: 30_000,
	socketTimeoutMs: 30_000
};

function isMissingArchiveObjectJobResponse(data: unknown): boolean {
	return isObject(data) && data.error === 'Archive object job not found';
}

@injectable()
export class RESTScanCoordinatorService implements ScanCoordinatorService {
	constructor(
		private readonly httpService: HttpService,
		private readonly coordinatorAPIBaseUrl: string,
		private readonly coordinatorAuth: CoordinatorAuthConfig
	) {}

	async registerScan(scan: Scan): Promise<Result<void, Error>> {
		const urlResult = this.createUrl(this.getRegisterScanPath());
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		if (scan.scanJobRemoteId === null) {
			return err(new CoordinatorServiceError('Scan job remote ID is null'));
		}

		const scanDTO = mapScanToDTO(scan);

		const response = await this.httpService.post(
			urlResult.value,
			scanDTO as unknown as Record<string, unknown>,
			this.getHttpOptions()
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(
					'Failed to save scan result',
					response.error
				)
			);
		}

		if (response.value.status !== 201) {
			return err(new CoordinatorServiceError('Failed to save scan result'));
		}

		return ok(undefined);
	}

	async registerParsedLedgerHeaders(
		batch: ParsedLedgerHeaderBatchDTO
	): Promise<Result<void, Error>> {
		return this.registerParsedHistoryBatch(
			'/v1/history-scan/parsed-ledger-headers',
			batch,
			'Failed to save parsed ledger headers'
		);
	}

	async registerParsedTransactionEnvelopes(
		batch: ParsedTransactionEnvelopeBatchDTO
	): Promise<Result<void, Error>> {
		return this.registerParsedHistoryBatch(
			'/v1/history-scan/parsed-transaction-envelopes',
			batch,
			'Failed to save parsed transaction envelopes'
		);
	}

	async registerParsedTransactionResults(
		batch: ParsedTransactionResultBatchDTO
	): Promise<Result<void, Error>> {
		return this.registerParsedHistoryBatch(
			'/v1/history-scan/parsed-transaction-results',
			batch,
			'Failed to save parsed transaction results'
		);
	}

	async getScanJob(): Promise<Result<ScanJobDTO | null, Error>> {
		const urlResult = this.createUrl(this.getScanJobPath());
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.get(
			urlResult.value,
			this.getHttpOptions({
				...coordinatorReadOptions,
				responseType: 'json'
			})
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(
					'Failed to get pending jobs',
					response.error
				)
			);
		}

		if (response.value.status === 204) {
			return ok(null);
		}

		if (response.value.status !== 200) {
			return err(new CoordinatorServiceError('Failed to get pending jobs'));
		}

		const scanJobJSON = response.value.data;

		if (!isObject(scanJobJSON)) {
			return err(
				new CoordinatorServiceError('Scan Job JSON must be an object')
			);
		}

		const scanJobDTOsResult = this.convertResponseToScanJobDTO(scanJobJSON);
		if (scanJobDTOsResult.isErr()) {
			return err(scanJobDTOsResult.error);
		}

		return ok(scanJobDTOsResult.value);
	}

	async getHistoryArchiveObjectJob(): Promise<
		Result<HistoryArchiveObjectJobDTO | null, Error>
	> {
		const urlResult = this.createUrl('/v1/history-scan/archive-object-job');
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.get(
			urlResult.value,
			this.getHttpOptions({
				...coordinatorReadOptions,
				responseType: 'json'
			})
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(
					'Failed to get pending history archive object jobs',
					response.error
				)
			);
		}

		if (response.value.status === 204) return ok(null);
		if (response.value.status !== 200) {
			return err(
				new CoordinatorServiceError(
					'Failed to get pending history archive object jobs'
				)
			);
		}

		return parseHistoryArchiveObjectJobDTO(response.value.data);
	}

	async getHistoryArchiveContentReuse(
		request: HistoryArchiveContentReuseRequestV1
	): Promise<Result<HistoryArchiveReusableContentV1 | null, Error>> {
		return requestReusableHistoryArchiveContent(
			this.httpService,
			this.coordinatorAPIBaseUrl,
			this.coordinatorAuth,
			request
		);
	}

	async touchScanJob(
		remoteId: string,
		progress?: ScanJobProgressDTO
	): Promise<Result<void, Error>> {
		const urlResult = this.createUrl(this.getTouchScanJobPath(remoteId));
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			progress === undefined ? {} : { ...progress },
			this.getHttpOptions()
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError('Failed to touch scan job', response.error)
			);
		}

		if (response.value.status !== 204) {
			return err(new CoordinatorServiceError('Failed to touch scan job'));
		}

		return ok(undefined);
	}

	async touchHistoryArchiveObject(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressDTO
	): Promise<Result<void, Error>> {
		return this.postHistoryArchiveObjectJobUpdate(
			remoteId,
			'heartbeat',
			progress === undefined ? {} : { ...progress },
			'Failed to touch history archive object job'
		);
	}

	async completeHistoryArchiveObject(
		remoteId: string,
		completion: HistoryArchiveObjectCompletionDTO
	): Promise<Result<void, Error>> {
		return this.postHistoryArchiveObjectJobUpdate(
			remoteId,
			'complete',
			{ ...completion },
			'Failed to complete history archive object job'
		);
	}

	async failHistoryArchiveObject(
		remoteId: string,
		failure: HistoryArchiveObjectFailureDTO
	): Promise<Result<void, Error>> {
		return this.postHistoryArchiveObjectJobUpdate(
			remoteId,
			'fail',
			{ ...failure },
			'Failed to fail history archive object job'
		);
	}

	async releaseHistoryArchiveObject(
		remoteId: string,
		claimAttempt: number
	): Promise<Result<void, Error>> {
		return this.postHistoryArchiveObjectJobUpdate(
			remoteId,
			'release',
			{ claimAttempt },
			'Failed to release history archive object job'
		);
	}

	async releaseScanJob(remoteId: string): Promise<Result<void, Error>> {
		if (this.coordinatorAuth.type === 'community') return ok(undefined);

		const urlResult = this.createUrl(this.getReleaseScanJobPath(remoteId));
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			{},
			this.getHttpOptions()
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(
					'Failed to release scan job',
					response.error
				)
			);
		}

		if (response.value.status !== 204 && response.value.status !== 404) {
			return err(new CoordinatorServiceError('Failed to release scan job'));
		}

		return ok(undefined);
	}

	private createUrl(path: string): Result<Url, Error> {
		return Url.create(`${this.coordinatorAPIBaseUrl}${path}`);
	}

	private getRegisterScanPath(): string {
		if (this.coordinatorAuth.type === 'community') {
			return `/v1/community-scanners/${this.coordinatorAuth.scannerId}/scans`;
		}

		return '/v1/history-scan';
	}

	private getScanJobPath(): string {
		if (this.coordinatorAuth.type === 'community') {
			return `/v1/community-scanners/${this.coordinatorAuth.scannerId}/job`;
		}

		return '/v1/history-scan/job';
	}

	private getTouchScanJobPath(remoteId: string): string {
		if (this.coordinatorAuth.type === 'community') {
			return `/v1/community-scanners/${this.coordinatorAuth.scannerId}/job/${remoteId}/heartbeat`;
		}

		return `/v1/history-scan/job/${remoteId}/heartbeat`;
	}

	private getHistoryArchiveObjectJobPath(
		remoteId: string,
		action: 'heartbeat' | 'complete' | 'fail' | 'release'
	): string {
		return `/v1/history-scan/archive-object-job/${remoteId}/${action}`;
	}

	private getReleaseScanJobPath(remoteId: string): string {
		return `/v1/history-scan/job/${remoteId}/release`;
	}

	private async registerParsedHistoryBatch(
		path: string,
		batch:
			| ParsedLedgerHeaderBatchDTO
			| ParsedTransactionEnvelopeBatchDTO
			| ParsedTransactionResultBatchDTO,
		errorMessage: string
	): Promise<Result<void, Error>> {
		if (this.coordinatorAuth.type === 'community') return ok(undefined);

		const urlResult = this.createUrl(path);
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			batch as unknown as Record<string, unknown>,
			this.getHttpOptions(coordinatorWriteOptions)
		);

		return mapParsedHistoryRegistrationResponse(response, errorMessage);
	}

	private getHttpOptions(options: HttpOptions = {}): HttpOptions {
		if (this.coordinatorAuth.type === 'community') {
			return {
				...options,
				headers: {
					...options.headers,
					Authorization: `Bearer ${this.coordinatorAuth.apiKey}`
				}
			};
		}

		return {
			...options,
			auth: {
				username: this.coordinatorAuth.username,
				password: this.coordinatorAuth.password
			}
		};
	}

	private convertResponseToScanJobDTO(
		response: Record<string, unknown>
	): Result<ScanJobDTO, Error> {
		const scanJobDTO = ScanJobDTO.fromJSON(response as ScanJobJSONInput);
		if (scanJobDTO.isErr()) {
			return err(new CoordinatorServiceError('Invalid response format'));
		}

		return ok(scanJobDTO.value);
	}

	private async postHistoryArchiveObjectJobUpdate(
		remoteId: string,
		action: 'heartbeat' | 'complete' | 'fail' | 'release',
		data: Record<string, unknown>,
		errorMessage: string
	): Promise<Result<void, Error>> {
		const isTerminalUpdate =
			action === 'complete' || action === 'fail' || action === 'release';
		const urlResult = this.createUrl(
			this.getHistoryArchiveObjectJobPath(remoteId, action)
		);
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			data,
			this.getHttpOptions(coordinatorWriteOptions)
		);

		if (response.isErr()) {
			if (
				isTerminalUpdate &&
				isHttpError(response.error) &&
				response.error.response?.status === 404 &&
				isMissingArchiveObjectJobResponse(response.error.response.data)
			) {
				return ok(undefined);
			}
			return err(new CoordinatorServiceError(errorMessage, response.error));
		}

		if (
			response.value.status === 404 &&
			isTerminalUpdate &&
			isMissingArchiveObjectJobResponse(response.value.data)
		) {
			return ok(undefined);
		}
		if (response.value.status !== 204) {
			return err(new CoordinatorServiceError(errorMessage));
		}

		return ok(undefined);
	}
}
