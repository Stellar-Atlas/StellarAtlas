import express from 'express';
import { body, validationResult } from 'express-validator';
import {
	isArchiveMetadataDTO,
	isScanErrorTypeDTO,
	isScanEvidenceDTO,
	ScanDTO
} from 'history-scanner-dto';
import type { ScanJobProgressUpdate } from '../../domain/ScanJobRepository.js';

type MutableScanJobProgressUpdate = {
	-readonly [Key in keyof ScanJobProgressUpdate]: ScanJobProgressUpdate[Key];
};

export function requireObjectBody(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
): express.Response | void {
	if (
		typeof req.body !== 'object' ||
		req.body === null ||
		Array.isArray(req.body)
	) {
		return res.status(400).json({ error: 'Request body must be an object' });
	}

	next();
}

export const scanDtoValidators = [
	body('startDate').isISO8601().withMessage('Invalid startDate'),
	body('endDate').isISO8601().withMessage('Invalid endDate'),
	body('scanChainInitDate')
		.isISO8601()
		.withMessage('Invalid scanChainInitDate'),
	body('baseUrl').isURL().withMessage('Invalid baseUrl'),
	body('latestVerifiedLedger')
		.isInt({ min: 0 })
		.withMessage('latestVerifiedLedger must be a positive integer'),
	body('latestScannedLedger')
		.isInt({ min: 0 })
		.withMessage('latestScannedLedger must be a positive integer'),
	body('latestScannedLedgerHeaderHash').custom((value) => {
		if (value === null) return true;
		return typeof value === 'string';
	}),
	body('concurrency')
		.isInt({ min: 0 })
		.withMessage('concurrency must be a positive integer'),
	body('isSlowArchive')
		.optional()
		.custom((value) => {
			if (value === null) return true;
			return typeof value === 'boolean';
		})
		.withMessage('isSlowArchive must be null or a boolean'),
	body('fromLedger')
		.isInt({ min: 0 })
		.withMessage('fromLedger must be a positive integer'),
	body('toLedger')
		.custom((value) => {
			if (value === null) return true;
			if (Number.isInteger(value) && value >= 0) return true;
			return false;
		})
		.withMessage('toLedger must be null or a positive integer'),
	body('scanJobRemoteId').isString().withMessage('Invalid scan job remoteId'),
	body('error').custom((value) => {
		if (value === null) return true;
		return isValidScanErrorPayload(value);
	}),
	body('errors').optional().isArray().withMessage('errors must be an array'),
	body('errors.*').custom((value) => {
		return isValidScanErrorPayload(value);
	}),
	body('evidence')
		.optional()
		.isArray()
		.withMessage('evidence must be an array'),
	body('evidence.*').custom((value) => {
		return isScanEvidenceDTO(value);
	}),
	body('archiveMetadata').optional().custom((value) => {
		return isArchiveMetadataDTO(value);
	})
];

export function parseValidatedScanDto(
	req: express.Request,
	res: express.Response
): ScanDTO | null {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		res.status(400).json({ errors: errors.array() });
		return null;
	}

	const dto = ScanDTO.fromJSON(req.body);
	if (dto.isErr()) {
		res.status(400).json({ error: 'Invalid request body' });
		return null;
	}

	return dto.value;
}

export function parseScanJobProgressUpdate(
	req: express.Request,
	res: express.Response
): ScanJobProgressUpdate | null {
	const body = req.body;
	if (body === undefined) return {};
	if (!isRecord(body)) {
		res.status(400).json({ error: 'Request body must be an object' });
		return null;
	}

	const progress: MutableScanJobProgressUpdate = {};
	const concurrency = readOptionalInteger(body, 'concurrency', 1);
	const fromLedger = readOptionalInteger(body, 'fromLedger', 0);
	const toLedger = readOptionalNullableInteger(body, 'toLedger', 0);
	const latestScannedLedger = readOptionalInteger(
		body,
		'latestScannedLedger',
		0
	);
	const latestScannedLedgerHeaderHash = readOptionalNullableString(
		body,
		'latestScannedLedgerHeaderHash'
	);
	const invalidField = [
		concurrency,
		fromLedger,
		toLedger,
		latestScannedLedger,
		latestScannedLedgerHeaderHash
	].find((value) => value instanceof Error);
	if (invalidField instanceof Error) {
		res.status(400).json({ error: invalidField.message });
		return null;
	}

	if (concurrency !== undefined && !(concurrency instanceof Error)) {
		progress.concurrency = concurrency;
	}
	if (fromLedger !== undefined && !(fromLedger instanceof Error)) {
		progress.fromLedger = fromLedger;
	}
	if (toLedger !== undefined && !(toLedger instanceof Error)) {
		progress.toLedger = toLedger;
	}
	if (
		latestScannedLedger !== undefined &&
		!(latestScannedLedger instanceof Error)
	) {
		progress.latestScannedLedger = latestScannedLedger;
	}
	if (
		latestScannedLedgerHeaderHash !== undefined &&
		!(latestScannedLedgerHeaderHash instanceof Error)
	) {
		progress.latestScannedLedgerHeaderHash = latestScannedLedgerHeaderHash;
	}

	return progress;
}

function isValidScanErrorPayload(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		isScanErrorTypeDTO(candidate.type) &&
		typeof candidate.url === 'string' &&
		typeof candidate.message === 'string'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalInteger(
	body: Record<string, unknown>,
	field: string,
	minimum: number
): number | undefined | Error {
	const value = body[field];
	if (value === undefined) return undefined;
	if (typeof value === 'number' && Number.isInteger(value) && value >= minimum) {
		return value;
	}

	return new Error(
		`${field} must be an integer greater than or equal to ${minimum}`
	);
}

function readOptionalNullableInteger(
	body: Record<string, unknown>,
	field: string,
	minimum: number
): number | null | undefined | Error {
	const value = body[field];
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value === 'number' && Number.isInteger(value) && value >= minimum) {
		return value;
	}

	return new Error(
		`${field} must be null or an integer greater than or equal to ${minimum}`
	);
}

function readOptionalNullableString(
	body: Record<string, unknown>,
	field: string
): string | null | undefined | Error {
	const value = body[field];
	if (value === undefined) return undefined;
	if (value === null || typeof value === 'string') return value;

	return new Error(`${field} must be null or a string`);
}
