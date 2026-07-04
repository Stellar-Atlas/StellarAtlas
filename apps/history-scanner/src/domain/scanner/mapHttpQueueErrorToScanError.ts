import { FileNotFoundError, isHttpError, QueueError } from 'http-helper';
import 'reflect-metadata';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';

export function mapHttpQueueErrorToScanError(error: QueueError): ScanError {
	if (error instanceof FileNotFoundError) {
		return new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			error.request.url.value,
			'File not found'
		);
	}
	if (error.cause instanceof ScanError) {
		return error.cause;
	}
	if (isHttpError(error.cause) && isArchiveEvidenceStatus(error.cause)) {
		const status = error.cause.response?.status;
		const statusText = error.cause.response?.statusText;
		return new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			error.request.url.value,
			`HTTP ${status}${statusText ? ` ${statusText}` : ''}`
		);
	}
	return new ScanError(
		ScanErrorType.TYPE_CONNECTION,
		error.request.url.value,
		error.cause?.message ?? 'Connection error'
	);
}

function isArchiveEvidenceStatus(error: { response?: { status: number } }) {
	const status = error.response?.status;
	return status !== undefined && status >= 400 && status < 500;
}
