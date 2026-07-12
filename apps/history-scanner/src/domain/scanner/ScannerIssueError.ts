export class ScannerIssueError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ScannerIssueError';
	}
}
