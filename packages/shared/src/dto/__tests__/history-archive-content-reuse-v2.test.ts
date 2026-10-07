import { isHistoryArchiveContentReuseRequestV1 } from '../history-archive-content-reuse-v1.js';
import {
	isHistoryArchiveReusableContentResponse,
	isHistoryArchiveReusableContentV2,
	type HistoryArchiveReusableContentV2
} from '../history-archive-content-reuse-v2.js';

const response: HistoryArchiveReusableContentV2 = {
	format: 'compact-v2',
	artifactId: 'fd14a697-c313-4c36-b2d0-9912c6f39a89',
	sourceObjectRemoteId: '1d94618f-017f-40e6-aaee-35873426127c',
	contentDigest: 'a'.repeat(64),
	contentRepresentation: 'uncompressed-xdr',
	derivationVersion: 1,
	binding: {
		remoteId: '10cb112d-78c1-4895-bc61-4c3d96b25374',
		executionId: 'b2a74a0c-008b-4a6e-af8a-1b9e0e9b660f',
		claimAttempt: 1,
		objectType: 'ledger',
		objectKey: 'ledger:0000003f',
		checkpointLedger: 63,
		sourceUrl: 'https://archive.example/é'
	},
	summary: {
		entryCount: 64,
		firstLedger: 0,
		lastLedger: 63,
		ledgerCount: 64,
		headerHashesVerified: true
	}
};
describe('strict negotiated compact content DTO', () => {
	it('accepts exact V2 metadata and additive request negotiation', () => {
		expect(isHistoryArchiveReusableContentV2(response)).toBe(true);
		expect(isHistoryArchiveReusableContentResponse(response)).toBe(true);
		const request = {
			...response.binding,
			contentDigest: response.contentDigest,
			contentRepresentation: response.contentRepresentation,
			derivationVersion: 1
		};
		expect(isHistoryArchiveContentReuseRequestV1(request)).toBe(true);
		expect(
			isHistoryArchiveContentReuseRequestV1({
				...request,
				responseFormat: 'compact-v2'
			})
		).toBe(true);
		expect(
			isHistoryArchiveContentReuseRequestV1({
				...request,
				responseFormat: 'future-v3'
			})
		).toBe(false);
	});
	it.each([
		['null', null],
		['empty', {}],
		['array', []],
		['version', { ...response, derivationVersion: 2 }],
		['representation', { ...response, contentRepresentation: 'compressed' }],
		['digest', { ...response, contentDigest: 'bad' }],
		['artifact', { ...response, artifactId: 'bad' }],
		['source', { ...response, sourceObjectRemoteId: 'bad' }],
		['format', { ...response, format: 'v3' }],
		['facts', { ...response, verificationFacts: {} }],
		[
			'remote',
			{ ...response, binding: { ...response.binding, remoteId: 'bad' } }
		],
		[
			'token',
			{ ...response, binding: { ...response.binding, executionId: 'bad' } }
		],
		[
			'attempt',
			{ ...response, binding: { ...response.binding, claimAttempt: 0 } }
		],
		[
			'fractionalAttempt',
			{ ...response, binding: { ...response.binding, claimAttempt: 1.1 } }
		],
		[
			'scp',
			{ ...response, binding: { ...response.binding, objectType: 'scp' } }
		],
		[
			'nullURL',
			{ ...response, binding: { ...response.binding, sourceUrl: null } }
		],
		[
			'checkpoint',
			{ ...response, binding: { ...response.binding, checkpointLedger: 62 } }
		],
		[
			'counts',
			{ ...response, summary: { ...response.summary, entryCount: 63 } }
		],
		[
			'nan',
			{ ...response, summary: { ...response.summary, ledgerCount: NaN } }
		],
		[
			'range',
			{ ...response, summary: { ...response.summary, firstLedger: 64 } }
		],
		[
			'headers',
			{
				...response,
				summary: { ...response.summary, headerHashesVerified: false }
			}
		],
		[
			'arrayPayload',
			{ ...response, summary: { ...response.summary, ledgers: [] } }
		]
	])('rejects malformed %s', (_name, value) => {
		expect(isHistoryArchiveReusableContentV2(value)).toBe(false);
		expect(isHistoryArchiveReusableContentResponse(value)).toBe(false);
	});
	it('supports genuine empty categories without fabricating nonempty coverage', () => {
		const empty = {
			...response,
			binding: { ...response.binding, objectType: 'transactions' },
			summary: {
				entryCount: 0,
				ledgerCount: 0,
				firstLedger: null,
				lastLedger: null
			}
		};
		expect(isHistoryArchiveReusableContentV2(empty)).toBe(true);
		expect(
			isHistoryArchiveReusableContentV2({
				...empty,
				summary: { ...empty.summary, entryCount: 1 }
			})
		).toBe(false);
	});
	it('keeps legacy V1 handling and rejects unknown discriminators even with legacy facts', () => {
		const {
			format: _format,
			binding: _binding,
			summary: _summary,
			...ref
		} = response;
		expect(
			isHistoryArchiveReusableContentResponse({ ...ref, verificationFacts: {} })
		).toBe(true);
		expect(
			isHistoryArchiveReusableContentResponse({
				...ref,
				format: 'unknown',
				verificationFacts: {}
			})
		).toBe(false);
	});
});
