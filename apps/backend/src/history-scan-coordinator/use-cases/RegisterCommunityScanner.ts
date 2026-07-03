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
import {
	generateCommunityScannerApiKey,
	hashCommunityScannerApiKey
} from '../domain/CommunityScannerApiKey.js';
import { TYPES } from '../infrastructure/di/di-types.js';

export interface RegisterCommunityRequest {
	readonly name: string;
	readonly description?: string;
	readonly contactEmail: string;
}

export interface RegisteredCommunityScannerDTO {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
	readonly status: ScannerStatus;
	readonly apiKey: string;
	readonly createdAt: string;
}

export class DuplicateCommunityScannerError extends Error {
	constructor() {
		super('Scanner with this email already exists');
		this.name = 'DuplicateCommunityScannerError';
	}
}

@injectable()
export class RegisterCommunityScanner {
	constructor(
		@inject(TYPES.CommunityScannerRepository)
		private readonly scannerRepository: Repository<CommunityScanner>,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		request: RegisterCommunityRequest
	): Promise<
		Result<
			RegisteredCommunityScannerDTO,
			DuplicateCommunityScannerError | Error
		>
	> {
		const normalizedEmail = request.contactEmail.toLowerCase().trim();
		const trimmedName = request.name.trim();
		const trimmedDescription = request.description?.trim();

		try {
			const existingScanner = await this.scannerRepository.findOne({
				where: { contactEmail: normalizedEmail }
			});

			if (existingScanner) {
				return err(new DuplicateCommunityScannerError());
			}

			const apiKey = generateCommunityScannerApiKey();
			const scanner = this.scannerRepository.create({
				name: trimmedName,
				description:
					trimmedDescription && trimmedDescription.length > 0
						? trimmedDescription
						: undefined,
				contactEmail: normalizedEmail,
				apiKeyHash: hashCommunityScannerApiKey(apiKey),
				status: ScannerStatus.PENDING
			});
			const savedScanner = await this.scannerRepository.save(scanner);

			return ok({
				id: savedScanner.id,
				name: savedScanner.name,
				description: savedScanner.description ?? null,
				status: savedScanner.status,
				apiKey,
				createdAt: (savedScanner.createdAt ?? new Date()).toISOString()
			});
		} catch (e) {
			if (isContactEmailUniqueViolation(e)) {
				return err(new DuplicateCommunityScannerError());
			}

			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function isContactEmailUniqueViolation(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;

	const code = 'code' in error ? error.code : undefined;
	if (code !== '23505') return false;

	const constraint = 'constraint' in error ? error.constraint : undefined;
	if (constraint === 'idx_community_scanners_contact_email_unique') return true;

	const detail = 'detail' in error ? error.detail : undefined;
	return typeof detail === 'string' && detail.includes('contact_email');
}
