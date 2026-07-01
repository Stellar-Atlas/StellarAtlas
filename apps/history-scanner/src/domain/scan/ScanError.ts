export enum ScanErrorType {
	TYPE_VERIFICATION,
	TYPE_CONNECTION
}

export class ScanError implements Error {
	public readonly name = 'ScanError';
	public readonly type: ScanErrorType;
	public readonly url: string;
	public readonly message: string;
	public readonly relatedErrors: readonly ScanError[];

	constructor(
		type: ScanErrorType,
		url: string,
		message: string,
		relatedErrors: readonly ScanError[] = []
	) {
		this.type = type;
		this.url = url;
		this.message = message;
		this.relatedErrors = relatedErrors;
	}

	equals(other: this): boolean {
		return (
			this.type === other.type &&
			this.url === other.url &&
			this.message === other.message
		);
	}
}
