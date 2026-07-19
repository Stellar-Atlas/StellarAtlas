import { HistoryArchiveStateSnapshot } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { mapHistoryArchiveStateSnapshot } from '../mapHistoryArchiveStateSnapshot.js';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';

describe('mapHistoryArchiveStateSnapshot', () => {
	it('keeps current failure separate from latest failure evidence', () => {
		const snapshot = HistoryArchiveStateSnapshot.failure({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			errorMessage: 'HTTP 403 Forbidden',
			errorType: 'http-status',
			httpStatus: 403,
			observedAt: new Date('2026-07-09T10:00:00.000Z'),
			source: 'history-scanner',
			stateUrl: 'https://history.example.com/.well-known/stellar-history.json',
			status: 'unreachable'
		});

		expect(mapHistoryArchiveStateSnapshot(snapshot)).toMatchObject({
			status: 'unreachable',
			failure: {
				message: 'HTTP 403 Forbidden',
				type: 'http-status',
				httpStatus: 403
			},
			latestFailure: {
				message: 'HTTP 403 Forbidden',
				type: 'http-status',
				httpStatus: 403,
				observedAt: '2026-07-09T10:00:00.000Z',
				source: 'history-scanner'
			}
		});
	});

	it('can expose an available state without failure evidence', () => {
		const snapshot = HistoryArchiveStateSnapshot.available(
			'https://history.example.com',
			'https://history.example.com',
			createArchiveMetadata(),
			'history-scanner'
		);

		expect(mapHistoryArchiveStateSnapshot(snapshot)).toMatchObject({
			status: 'available',
			failure: null,
			latestFailure: null,
			metadata: {
				stellarHistory: {
					currentLedger: 127
				}
			}
		});
	});

	it('reports a failed refresh after retained successful state', () => {
		const snapshot = createAvailableWithFailure(
			'2026-07-09T09:00:00.000Z',
			'2026-07-09T10:00:00.000Z'
		);

		expect(mapHistoryArchiveStateSnapshot(snapshot)).toMatchObject({
			status: 'available',
			latestFailure: {
				observedAt: '2026-07-09T10:00:00.000Z'
			}
		});
	});

	it('reports recovery while retaining the previous failure', () => {
		const snapshot = createAvailableWithFailure(
			'2026-07-09T11:00:00.000Z',
			'2026-07-09T10:00:00.000Z'
		);

		expect(mapHistoryArchiveStateSnapshot(snapshot)).toMatchObject({
			status: 'available',
			latestFailure: {
				observedAt: '2026-07-09T10:00:00.000Z'
			}
		});
	});
});

function createAvailableWithFailure(
	successObservedAt: string,
	failureObservedAt: string
): HistoryArchiveStateSnapshot {
	const snapshot = HistoryArchiveStateSnapshot.available(
		'https://history.example.com',
		'https://history.example.com',
		{ ...createArchiveMetadata(), observedAt: successObservedAt },
		'history-scanner'
	);
	Object.assign(snapshot, {
		latestFailureHttpStatus: 503,
		latestFailureMessage: 'HTTP 503 Service Unavailable',
		latestFailureObservedAt: new Date(failureObservedAt),
		latestFailureSource: 'history-scanner',
		latestFailureType: 'archive_http_error'
	});
	return snapshot;
}

function createArchiveMetadata(): ArchiveMetadataDTO {
	return {
		stellarHistoryUrl:
			'https://history.example.com/.well-known/stellar-history.json',
		observedAt: '2026-07-09T09:00:00.000Z',
		stellarHistory: {
			version: 1,
			server: 'stellar-core',
			currentLedger: 127,
			currentBuckets: []
		}
	};
}
