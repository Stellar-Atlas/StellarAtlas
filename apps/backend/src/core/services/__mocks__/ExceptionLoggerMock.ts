import type { ExceptionLogger } from '../ExceptionLogger.js';

export class ExceptionLoggerMock implements ExceptionLogger {
	captureException(error: Error): void {}
}
