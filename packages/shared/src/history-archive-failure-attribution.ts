export interface HistoryArchiveFailureAttributionInput {
	readonly httpStatus?: number | null;
	readonly errorType?: string | null;
	readonly errorMessage?: string | null;
}

// Kept as portable regular-expression sources so indexed SQL reads use the same rules.
export const historyArchiveContentFailurePattern =
	'(CONTENT|CHECKSUM|HASH|MISMATCH|INVALID|XDR|PROOF|MALFORMED)';
export const historyArchiveTransportFailurePattern =
	'(TRANSPORT|TIMEOUT|TIMEDOUT|ABORT|CANCEL|ECONN|ENETRESET|EPIPE|EAI_|ENOTFOUND|SOCKET|TLS)';
export const historyArchiveInterruptedMessagePattern =
	'(^|[^A-Z0-9])(ABORTED|ABORT_ERR|ABORTERROR|ERR_CANCELED|ERR_CANCELLED|ECONNRESET|ECONNABORTED|ENETRESET|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT|ERR_REQUEST_ABORTED|ERR_STREAM_PREMATURE_CLOSE|UND_ERR_(ABORTED|BODY_TIMEOUT|CONNECT_TIMEOUT|HEADERS_TIMEOUT|SOCKET)|Z_BUF_ERROR|SOCKET HANG UP|CONNECTION RESET|CONNECTION TIMED OUT|CONNECT TIMEOUT|CONNECTION TIMEOUT|REQUEST TIMED OUT|REQUEST TIMEOUT|TIMEOUT OF [0-9]+MS EXCEEDED)([^A-Z0-9]|$)';

const content = new RegExp(historyArchiveContentFailurePattern);
const transport = new RegExp(historyArchiveTransportFailurePattern);
const interrupted = new RegExp(historyArchiveInterruptedMessagePattern);

/** Inconclusive exchange, not proof of archive damage and not proof of a local fault. */
export function isHistoryArchiveInconclusiveTransportFailure(
	input: HistoryArchiveFailureAttributionInput
): boolean {
	if (
		typeof input.httpStatus === 'number' &&
		input.httpStatus >= 300 &&
		input.httpStatus <= 599
	)
		return false;
	const errorType = (input.errorType ?? '')
		.trim()
		.replaceAll('-', '_')
		.toUpperCase();
	if (content.test(errorType)) return false;
	return (
		transport.test(errorType) ||
		interrupted.test((input.errorMessage ?? '').toUpperCase())
	);
}
