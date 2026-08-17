import {
	isHistoryArchiveContentReuseRequestV1,
	isHistoryArchiveContentReuseV1,
	isHistoryArchiveReusableContentV1
} from '../../src/dto/history-archive-content-reuse-v1.js';

const remoteId = '277d58a0-0185-4c94-90ec-cbfd4e3ad2d4';
const executionId = '06161c4e-c064-408a-9f98-6feb15f2db08';
const artifactId = 'aeec1320-3a25-4bc3-b616-2e37bc2e98be';
const sourceObjectRemoteId = 'f84ee265-b3ac-43ca-b55e-7cc3bb086e54';
const digest = 'a'.repeat(64);

describe('history archive content reuse v1 guards', () => {
	it('accepts exact broker lookup requests', () => {
		expect(
			isHistoryArchiveContentReuseRequestV1({
				claimAttempt: 2,
				contentDigest: digest,
				contentRepresentation: 'uncompressed-xdr',
				derivationVersion: 1,
				executionId,
				objectKey: 'ledger:0000003f',
				objectType: 'ledger',
				remoteId
			})
		).toBe(true);
	});

	it.each([
		{ claimAttempt: 0 },
		{ contentDigest: digest.toUpperCase() },
		{ derivationVersion: 2 },
		{ executionId: 'not-a-uuid' },
		{ objectKey: '' },
		{ objectType: 'bucket' }
	])('rejects invalid request field %#', (replacement) => {
		expect(
			isHistoryArchiveContentReuseRequestV1({
				claimAttempt: 2,
				contentDigest: digest,
				contentRepresentation: 'uncompressed-xdr',
				derivationVersion: 1,
				executionId,
				objectKey: 'ledger:0000003f',
				objectType: 'ledger',
				remoteId,
				...replacement
			})
		).toBe(false);
	});

	it('distinguishes completion metadata from reusable facts', () => {
		const metadata = {
			artifactId,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1,
			sourceObjectRemoteId
		};
		expect(isHistoryArchiveContentReuseV1(metadata)).toBe(true);
		expect(isHistoryArchiveReusableContentV1(metadata)).toBe(false);
		expect(
			isHistoryArchiveReusableContentV1({
				...metadata,
				verificationFacts: {
					content: {
						algorithm: 'sha256',
						digest,
						representation: 'uncompressed-xdr'
					}
				}
			})
		).toBe(true);
	});
});
