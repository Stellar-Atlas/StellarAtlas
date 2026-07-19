export class ArchiveEvidenceReadModelUnavailableError extends Error {
	constructor(message = 'Archive evidence read model is not ready') {
		super(message);
		this.name = 'ArchiveEvidenceReadModelUnavailableError';
	}
}
