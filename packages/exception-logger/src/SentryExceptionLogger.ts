import * as Sentry from '@sentry/node';
import type { ExceptionLogger } from './ExceptionLogger.js';
import type { Logger } from 'logger';

export class SentryExceptionLogger implements ExceptionLogger {
	constructor(
		sentryDSN: string,
		protected logger: Logger
	) {
		Sentry.init({
			dsn: sentryDSN
		});
	}

	captureException(error: Error, extra?: Record<string, unknown>): void {
		this.logger.error(error.message, extra);
		Sentry.captureException(error, extra ? { extra: extra } : undefined);
	}
}
