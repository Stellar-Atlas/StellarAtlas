import 'reflect-metadata';
import { CustomError } from 'custom-error';
import { Url, type HttpOptions, type HttpService } from 'http-helper';
import { injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { Scan } from '../../domain/scan/Scan.js';
import {
	ParsedLedgerHeaderBatchDTO,
	ScanDTO,
	ScanJobDTO,
	type ScanErrorDTO,
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
import { isObject } from 'shared';
import { type ScanError, ScanErrorType } from '../../domain/scan/ScanError.js';
import type { CoordinatorAuthConfig } from '../config/CoordinatorAuthConfig.js';

export class CoordinatorServiceError extends CustomError {
	constructor(message: string, cause?: Error) {
		super(message, CoordinatorServiceError.name, cause);
	}
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

		const scanDTO = this.convertScanToDTO(scan);

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
		if (this.coordinatorAuth.type === 'community') return ok(undefined);

		const urlResult = this.createUrl('/v1/history-scan/parsed-ledger-headers');
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			batch as unknown as Record<string, unknown>,
			this.getHttpOptions()
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(
					'Failed to save parsed ledger headers',
					response.error
				)
			);
		}

		if (response.value.status !== 201) {
			return err(
				new CoordinatorServiceError('Failed to save parsed ledger headers')
			);
		}

		return ok(undefined);
	}

	private convertScanToDTO(scan: Scan): ScanDTO {
		const errors = scan.errors.map((error) => this.mapScanErrorToDTO(error));

		return {
			baseUrl: scan.baseUrl.value,
			startDate: scan.startDate,
			endDate: scan.endDate,
			scanChainInitDate: scan.scanChainInitDate,
			fromLedger: scan.fromLedger,
			toLedger: scan.toLedger,
			latestVerifiedLedger: scan.latestVerifiedLedger,
			latestScannedLedger: scan.latestScannedLedger,
			latestScannedLedgerHeaderHash: scan.latestScannedLedgerHeaderHash,
			concurrency: scan.concurrency,
			isSlowArchive: scan.isSlowArchive,
			error: scan.error ? this.mapScanErrorToDTO(scan.error) : null,
			scanJobRemoteId: scan.scanJobRemoteId!,
			errors,
			evidence: scan.evidence,
			archiveMetadata: scan.archiveMetadata ?? undefined
		};
	}

	private mapScanErrorToDTO(error: ScanError): ScanErrorDTO {
		return {
			message: error.message,
			type: this.mapScanErrorTypeToDTO(error.type),
			url: error.url
		};
	}

	private mapScanErrorTypeToDTO(type: ScanErrorType): ScanErrorDTO['type'] {
		switch (type) {
			case ScanErrorType.TYPE_VERIFICATION:
				return 'TYPE_VERIFICATION';
			case ScanErrorType.TYPE_CONNECTION:
				return 'TYPE_CONNECTION';
		}
	}

	async getScanJob(): Promise<Result<ScanJobDTO | null, Error>> {
		const urlResult = this.createUrl(this.getScanJobPath());
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.get(
			urlResult.value,
			this.getHttpOptions({ responseType: 'json' })
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
			this.getHttpOptions({ responseType: 'json' })
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

		return this.convertResponseToHistoryArchiveObjectJobDTO(
			response.value.data
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
		const urlResult = this.createUrl(
			this.getHistoryArchiveObjectJobPath(remoteId, action)
		);
		if (urlResult.isErr()) {
			return err(new CoordinatorServiceError('Invalid URL', urlResult.error));
		}

		const response = await this.httpService.post(
			urlResult.value,
			data,
			this.getHttpOptions()
		);

		if (response.isErr()) {
			return err(
				new CoordinatorServiceError(errorMessage, response.error)
			);
		}

		if (response.value.status !== 204 && response.value.status !== 404) {
			return err(new CoordinatorServiceError(errorMessage));
		}

		if (response.value.status === 404) {
			return err(new CoordinatorServiceError('History archive object job not found'));
		}

		return ok(undefined);
	}

	private convertResponseToHistoryArchiveObjectJobDTO(
		response: unknown
	): Result<HistoryArchiveObjectJobDTO, Error> {
		if (!isObject(response)) {
			return err(
				new CoordinatorServiceError(
					'History archive object job JSON must be an object'
				)
			);
		}

		if (
			typeof response.archiveUrl !== 'string' ||
			typeof response.claimAttempt !== 'number' ||
			!Number.isSafeInteger(response.claimAttempt) ||
			typeof response.objectKey !== 'string' ||
			typeof response.objectType !== 'string' ||
			typeof response.objectUrl !== 'string' ||
			typeof response.remoteId !== 'string'
		) {
			return err(
				new CoordinatorServiceError(
					'Invalid history archive object job response format'
				)
			);
		}

		const checkpointLedger = response.checkpointLedger;
		if (
			checkpointLedger !== null &&
			checkpointLedger !== undefined &&
			(typeof checkpointLedger !== 'number' ||
				!Number.isSafeInteger(checkpointLedger))
		) {
			return err(
				new CoordinatorServiceError(
					'Invalid history archive object checkpoint ledger'
				)
			);
		}

		const bucketHash = response.bucketHash;
		if (
			bucketHash !== null &&
			bucketHash !== undefined &&
			typeof bucketHash !== 'string'
		) {
			return err(
				new CoordinatorServiceError('Invalid history archive object bucket hash')
			);
		}

		return ok({
			archiveUrl: response.archiveUrl,
			bucketHash: bucketHash ?? null,
			checkpointLedger: checkpointLedger ?? null,
			claimAttempt: response.claimAttempt,
			objectKey: response.objectKey,
			objectType: response.objectType,
			objectUrl: response.objectUrl,
			remoteId: response.remoteId
		});
	}
}
