import express from 'express';
import { body, validationResult } from 'express-validator';
import {
	isScanErrorTypeDTO,
	isScanEvidenceDTO,
	ScanDTO
} from 'history-scanner-dto';

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

function isValidScanErrorPayload(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		isScanErrorTypeDTO(candidate.type) &&
		typeof candidate.url === 'string' &&
		typeof candidate.message === 'string'
	);
}
