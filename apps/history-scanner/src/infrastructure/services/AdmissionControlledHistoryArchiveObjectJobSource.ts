import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from '../../use-cases/verify-archive-objects/HistoryArchiveObjectJobDelivery.js';
import type { HistoryArchiveClaimAdmission } from './LinuxIoPressureAdmission.js';

export class AdmissionControlledHistoryArchiveObjectJobSource implements HistoryArchiveObjectJobSource {
	readonly kind = 'broker' as const;
	private readonly closeController = new AbortController();
	private closed = false;

	constructor(
		private readonly source: HistoryArchiveObjectJobSource,
		private readonly admission: HistoryArchiveClaimAdmission
	) {
		if (source.kind !== 'broker') {
			throw new Error('Claim admission can only wrap a broker job source');
		}
	}

	async next(): Promise<HistoryArchiveObjectJobDelivery | null> {
		if (this.closed) return null;
		await this.admission.waitUntilAdmitted(this.closeController.signal);
		if (this.closed) return null;
		return this.source.next();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.closeController.abort();
		await this.source.close();
	}
}
