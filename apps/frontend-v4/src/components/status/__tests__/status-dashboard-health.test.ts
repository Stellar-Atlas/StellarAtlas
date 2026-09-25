import { parseStatusLiveMessage } from '@api/status-live-stream';
import { createStatusLivePayload } from '../../../api/__tests__/support/status-live-contract-fixtures';
import {
	compatibilityIndexStatus,
	platformMonitoringStatus
} from '../status-dashboard-health';

function history() {
	const message = parseStatusLiveMessage({
		type: 'status',
		payload: createStatusLivePayload()
	});
	if (message?.type !== 'status') throw new Error('Expected valid fixture');
	return message.payload.fullHistory;
}
describe('separate platform and compatibility-index health', () => {
	it('reports only API and network health in the platform badge', () => {
		expect(platformMonitoringStatus('ok', 'ok')).toBe('ok');
		expect(platformMonitoringStatus('ok', 'degraded')).toBe('degraded');
		expect(platformMonitoringStatus('unavailable', 'ok')).toBe('unavailable');
	});
	it('does not report OK when recorded state imports failed', () => {
		const current = history();
		const imports = current.ledgerCloseMetaState.imports;
		expect(
			compatibilityIndexStatus({
				...current,
				ledgerCloseMetaState: {
					...current.ledgerCloseMetaState,
					imports: {
						...imports,
						lifecycle: { ...imports.lifecycle, failed: 1 }
					}
				}
			})
		).not.toBe('ok');
	});
	it('does not report OK when the canonical promoter has failed', () => {
		const current = history();
		if (current.canonicalPromotion === null)
			throw new Error('Expected promotion fixture');
		expect(
			compatibilityIndexStatus({
				...current,
				canonicalPromotion: { ...current.canonicalPromotion, state: 'failed' }
			})
		).toBe('degraded');
	});
	it('keeps unavailable telemetry unavailable', () => {
		expect(
			compatibilityIndexStatus({
				...history(),
				status: 'unavailable',
				canonicalCoverage: null
			})
		).toBe('unavailable');
	});
});
