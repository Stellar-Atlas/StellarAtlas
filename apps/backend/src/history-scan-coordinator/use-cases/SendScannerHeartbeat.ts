import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Repository } from 'typeorm';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../infrastructure/database/entities/CommunityScanner.js';
import { isCommunityScannerApiKeyMatch } from '../domain/CommunityScannerApiKey.js';
import { TYPES } from '../infrastructure/di/di-types.js';

export interface SendHeartbeatRequest {
	readonly scannerId: string;
	readonly apiKey: string;
}

export interface ScannerHeartbeatDTO {
	readonly id: string;
	readonly lastHeartbeatAt: string;
	readonly status: ScannerStatus;
}

export class CommunityScannerNotFoundError extends Error {
	constructor() {
		super('Scanner not found');
		this.name = 'CommunityScannerNotFoundError';
	}
}

export class InvalidCommunityScannerApiKeyError extends Error {
	constructor() {
		super('Invalid API key');
		this.name = 'InvalidCommunityScannerApiKeyError';
	}
}

export class CommunityScannerBlacklistedError extends Error {
	constructor() {
		super('Scanner is blacklisted');
		this.name = 'CommunityScannerBlacklistedError';
	}
}

@injectable()
export class SendScannerHeartbeat {
	constructor(
		@inject(TYPES.CommunityScannerRepository)
		private readonly scannerRepository: Repository<CommunityScanner>,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		request: SendHeartbeatRequest
	): Promise<
		Result<
			ScannerHeartbeatDTO,
			| CommunityScannerNotFoundError
			| InvalidCommunityScannerApiKeyError
			| CommunityScannerBlacklistedError
			| Error
		>
	> {
		try {
			const scanner = await this.scannerRepository.findOne({
				where: { id: request.scannerId }
			});

			if (!scanner) {
				return err(new CommunityScannerNotFoundError());
			}

			if (!isCommunityScannerApiKeyMatch(request.apiKey, scanner.apiKeyHash)) {
				return err(new InvalidCommunityScannerApiKeyError());
			}

			if (scanner.isBlocked()) {
				return err(new CommunityScannerBlacklistedError());
			}

			scanner.updateHeartbeat();

			if (
				scanner.status === ScannerStatus.PENDING ||
				scanner.status === ScannerStatus.OFFLINE
			) {
				scanner.status = ScannerStatus.ONLINE;
			}

			const savedScanner = await this.scannerRepository.save(scanner);

			return ok({
				id: savedScanner.id,
				lastHeartbeatAt: (
					savedScanner.lastHeartbeatAt ?? new Date()
				).toISOString(),
				status: savedScanner.status
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
