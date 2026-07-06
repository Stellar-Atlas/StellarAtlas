import { ScanError, ScanErrorType } from '../scan/ScanError.js';

export class ArchiveScanErrorAccumulator {
	static readonly defaultMaxErrors = 100;
	private readonly errors: ScanError[] = [];
	private readonly keys = new Set<string>();

	constructor(
		private readonly maxErrors = ArchiveScanErrorAccumulator.defaultMaxErrors
	) {}

	add(error: ScanError): void {
		for (const relatedError of expandScanError(error)) {
			this.addOne(relatedError);
		}
	}

	addMany(errors: readonly ScanError[]): void {
		for (const error of errors) this.add(error);
	}

	get values(): readonly ScanError[] {
		return this.errors;
	}

	get first(): ScanError | undefined {
		return this.errors[0];
	}

	get isFull(): boolean {
		return this.errors.length >= this.maxErrors;
	}

	toAggregate(): ScanError | undefined {
		const firstError = this.first;
		if (firstError === undefined) return undefined;
		if (this.errors.length === 1) return firstError;

		return new ScanError(
			firstError.type,
			firstError.url,
			firstError.message,
			this.errors
		);
	}

	private addOne(error: ScanError): void {
		if (this.isFull) return;

		const key = `${error.type}\0${error.url}\0${error.message}`;
		if (this.keys.has(key)) return;

		this.keys.add(key);
		this.errors.push(error);
	}
}

export function expandScanError(error: ScanError): readonly ScanError[] {
	return error.relatedErrors.length > 0 ? error.relatedErrors : [error];
}

export function isArchiveAccessDeniedError(error: ScanError): boolean {
	return expandScanError(error).some(
		(scanError) =>
			scanError.type === ScanErrorType.TYPE_VERIFICATION &&
			/^HTTP 40[13](\s|$)/.test(scanError.message)
	);
}

export function isCollectableArchiveVerificationError(
	error: ScanError
): boolean {
	return (
		error.type === ScanErrorType.TYPE_VERIFICATION &&
		!isArchiveAccessDeniedError(error)
	);
}
