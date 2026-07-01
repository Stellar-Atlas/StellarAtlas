import type { ExceptionLogger } from './ExceptionLogger.js';

export class ConsoleExceptionLogger implements ExceptionLogger {
	captureException(error: Error): void {
		console.log('Captured exception', error);
	}
}
