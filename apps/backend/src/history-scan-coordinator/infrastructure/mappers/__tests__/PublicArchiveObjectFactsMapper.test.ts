import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { mapPublicArchiveUrl } from '../PublicArchiveObjectFactsMapper.js';
import { mapHistoryArchiveObject } from '../mapHistoryArchiveObject.js';

describe('public archive object mapping', () => {
	it('whitelists facts and removes internal paths and arbitrary worker data', () => {
		const object = createObject();
		object.errorMessage =
			'write /tmp/archive-cache failed at /home/observe/secret and C:\\temp\\x';
		object.errorType = 'bucket_cache_failure';
		object.failureChannel = 'scanner_issue';
		object.workerStage = 'file:///tmp/private-stage';
		object.verificationFacts = {
			arbitraryWorkerFacts: { path: '/home/observe/private' },
			checkpointHistoryArchiveState: { source: 'file:///tmp/raw-state' },
			checkpointHistoryArchiveStateFact: {
				bucketListHash: 'a'.repeat(64),
				checkpointLedger: 127,
				observedAt: '2026-07-10T00:00:00.000Z',
				stellarHistoryUrl: 'file:///tmp/raw-state'
			},
			content: {
				algorithm: 'sha256',
				digest: 'b'.repeat(64),
				representation: 'canonical-json'
			},
			ledgerCategory: {
				entryCount: 2,
				ledgers: [
					{ ledger: 63, localPath: '/tmp/ledger' },
					{ ledger: 127, error: '/home/observe/error' }
				]
			}
		} as never;

		const mapped = mapHistoryArchiveObject(object);
		const serialized = JSON.stringify(mapped);

		expect(mapped.error).toEqual({
			httpStatus: null,
			message: 'Scanner infrastructure issue',
			type: 'scanner_issue'
		});
		expect(mapped.workerStage).toBeNull();
		expect(mapped.verificationFacts).toEqual({
			checkpointHistoryArchiveStateFact: {
				bucketListHash: 'a'.repeat(64),
				checkpointLedger: 127,
				observedAt: '2026-07-10T00:00:00.000Z'
			},
			content: {
				algorithm: 'sha256',
				digest: 'b'.repeat(64),
				representation: 'canonical-json'
			},
			ledgerCategory: {
				entryCount: 2,
				firstLedger: 63,
				lastLedger: 127,
				ledgerCount: 2
			}
		});
		expect(serialized).not.toMatch(
			/\/tmp|\/home\/observe|file:\/\/|C:\\\\temp/
		);
	});

	it('never returns arbitrary remote error text or types', () => {
		const object = createObject();
		object.errorMessage = 'secret at /tmp/remote-body';
		object.errorType = '/home/observe/custom-error';
		object.failureChannel = 'archive_evidence';
		object.httpStatus = 503;

		expect(mapHistoryArchiveObject(object).error).toEqual({
			httpStatus: 503,
			message: 'Remote archive returned HTTP 503',
			type: 'archive_verification_failed'
		});
	});

	it('does not describe a content verification failure as an HTTP 200 error', () => {
		const object = createObject();
		object.errorMessage = 'bucket hash mismatch';
		object.errorType = 'bucket_verification_failed';
		object.failureChannel = 'archive_evidence';
		object.httpStatus = 200;

		expect(mapHistoryArchiveObject(object).error).toEqual({
			httpStatus: null,
			message: 'Remote archive verification failed',
			type: 'bucket_verification_failed'
		});
	});

	it('preserves a redirect status as remote HTTP evidence', () => {
		const object = createObject();
		object.errorMessage = 'redirect was not accepted';
		object.errorType = 'archive_http_error';
		object.failureChannel = 'archive_evidence';
		object.httpStatus = 302;

		expect(mapHistoryArchiveObject(object).error).toEqual({
			httpStatus: 302,
			message: 'Remote archive returned HTTP 302',
			type: 'archive_http_error'
		});
	});

	it('redacts non-public and raw-whitespace archive URLs', () => {
		expect(mapPublicArchiveUrl('file:///tmp/private')).toBe('[redacted]');
		expect(mapPublicArchiveUrl('https://user:secret@example.com/a')).toBe(
			'[redacted]'
		);
		expect(mapPublicArchiveUrl('https://example.com/a\n/internal')).toBe(
			'[redacted]'
		);
	});
});

function createObject(): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl: 'https://history.example.com',
		archiveUrlIdentity: 'https://history.example.com',
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl: 'https://history.example.com/.well-known/stellar-history.json'
	});
	(object as HistoryArchiveObject & { createdAt?: Date }).createdAt = new Date(
		'2026-07-10T00:00:00.000Z'
	);
	(object as HistoryArchiveObject & { updatedAt?: Date }).updatedAt = new Date(
		'2026-07-10T00:00:00.000Z'
	);
	return object;
}
