import type { HistoryArchiveCheckpointProofRefreshFailure } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { mapPublicArchiveUrl } from '../../mappers/PublicArchiveObjectFactsMapper.js';
import { sanitizePublicInfrastructureText } from '../../mappers/PublicScanErrorMapper.js';

export function mapCheckpointProofRefreshFailure(
	target: {
		readonly archiveUrlIdentity: string;
		readonly checkpointLedger: number;
	},
	error: unknown,
	failureRecorded: boolean
): HistoryArchiveCheckpointProofRefreshFailure {
	const outer = record(error);
	const driver = record(outer?.driverError);
	const code = driver?.code ?? outer?.code;
	const rawMessage = driver?.message ?? outer?.message;
	const publicRoot = mapPublicArchiveUrl(target.archiveUrlIdentity);
	const url = publicRoot === '[redacted]' ? null : new URL(publicRoot);
	if (url !== null) {
		url.search = '';
		url.hash = '';
	}
	return {
		archiveUrlIdentity: url?.toString().replace(/\/$/, '') ?? '[redacted]',
		checkpointLedger: target.checkpointLedger,
		databaseErrorCode:
			typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null,
		errorMessage: safeMessage(rawMessage),
		// False means the fenced UPDATE did not match, not that the exception was harmless.
		failureRecorded
	};
}

function safeMessage(value: unknown): string {
	if (typeof value !== 'string')
		return 'Unknown checkpoint proof refresh error';
	const firstLine = value.split(/[\r\n]/, 1)[0] ?? '';
	return (
		sanitizePublicInfrastructureText(firstLine)
			.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[URL]')
			.replace(
				/\b(password|passwd|pwd|token|secret|authorization|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi,
				'$1=[redacted]'
			)
			.replace(/\b(statement|query|parameters)\s*[:=].*/gi, '$1=[redacted]')
			.replace(/[\u0000-\u001f\u007f]/g, ' ')
			.trim()
			.slice(0, 240) || 'Unknown checkpoint proof refresh error'
	);
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: null;
}
