import { mock } from 'jest-mock-extended';
import type { HttpService } from 'http-helper';
import { ok } from 'neverthrow';
import type {
	HistoryArchiveContentReuseRequestV1,
	HistoryArchiveReusableContentV2
} from 'shared';
import { requestReusableHistoryArchiveContent } from '../HistoryArchiveContentReuseClient.js';

const request: HistoryArchiveContentReuseRequestV1 = {
	remoteId: '277d58a0-0185-4c94-90ec-cbfd4e3ad2d4',
	executionId: '06161c4e-c064-408a-9f98-6feb15f2db08',
	claimAttempt: 2,
	objectType: 'ledger',
	objectKey: 'ledger:0000003f',
	contentDigest: 'a'.repeat(64),
	contentRepresentation: 'uncompressed-xdr',
	derivationVersion: 1,
	responseFormat: 'compact-v2'
};
const auth = { type: 'internal', username: 'test', password: 'test' } as const;

describe('HistoryArchiveContentReuseClient response union', () => {
	it('requests compact-v2 and validates its summary without full ledger arrays', async () => {
		const response = compact();
		const http = transport(response);
		const result = await requestReusableHistoryArchiveContent(
			http,
			'https://coordinator.example',
			auth,
			request
		);
		expect(result._unsafeUnwrap()).toEqual(response);
		expect(http.post).toHaveBeenCalledWith(
			expect.anything(),
			request,
			expect.anything()
		);
	});

	it('accepts unchanged full V1 on a cold/older backend response', async () => {
		const {
			binding,
			format: _format,
			summary: _summary,
			...metadata
		} = compact();
		const response = {
			...metadata,
			verificationFacts: {
				content: {
					algorithm: 'sha256',
					digest: request.contentDigest,
					representation: 'uncompressed-xdr'
				},
				ledgerCategory: {
					sourceUrl: binding.sourceUrl,
					entryCount: 0,
					headerHashesVerified: true,
					ledgers: []
				}
			}
		};
		const result = await requestReusableHistoryArchiveContent(
			transport(response),
			'https://coordinator.example',
			auth,
			request
		);
		expect(result._unsafeUnwrap()).toEqual(response);
	});

	it.each([
		['null', null],
		['wrong format', { ...compact(), format: 'compact-v3' }],
		['unsupported derivation', { ...compact(), derivationVersion: 2 }],
		[
			'wrong representation',
			{ ...compact(), contentRepresentation: 'compressed-xdr' }
		],
		['missing binding', { ...compact(), binding: null }],
		['invalid artifact', { ...compact(), artifactId: 'not-a-uuid' }],
		[
			'missing ledger authentication',
			{
				...compact(),
				summary: { ...compact().summary, headerHashesVerified: false }
			}
		],
		[
			'inconsistent empty bounds',
			{
				...compact(),
				summary: {
					entryCount: 0,
					ledgerCount: 0,
					firstLedger: 0,
					lastLedger: 63,
					headerHashesVerified: true
				}
			}
		],
		['arrays disguised as summary', { ...compact(), summary: [] }],
		[
			'ledger arrays in summary',
			{ ...compact(), summary: { ...compact().summary, ledgers: [] } }
		],
		['full facts in compact response', { ...compact(), verificationFacts: {} }],
		[
			'ledger beyond bound checkpoint',
			{ ...compact(), summary: { ...compact().summary, lastLedger: 127 } }
		]
	])(
		'rejects %s instead of accepting unauthenticated cached evidence',
		async (_name, response) => {
			const result = await requestReusableHistoryArchiveContent(
				transport(response),
				'https://coordinator.example',
				auth,
				request
			);
			expect(result.isErr()).toBe(true);
		}
	);

	it('preserves a 204 miss', async () => {
		expect(
			(
				await requestReusableHistoryArchiveContent(
					transport(null, 204),
					'https://coordinator.example',
					auth,
					request
				)
			)._unsafeUnwrap()
		).toBeNull();
	});

	it('does not send internal cache credentials for a community worker', async () => {
		const http = transport(compact());
		const result = await requestReusableHistoryArchiveContent(
			http,
			'https://coordinator.example',
			{ type: 'community', scannerId: 'scanner', apiKey: 'key' },
			request
		);
		expect(result._unsafeUnwrap()).toBeNull();
		expect(http.post).not.toHaveBeenCalled();
	});
});

function compact(): HistoryArchiveReusableContentV2 {
	return {
		artifactId: 'aeec1320-3a25-4bc3-b616-2e37bc2e98be',
		sourceObjectRemoteId: 'f84ee265-b3ac-43ca-b55e-7cc3bb086e54',
		contentDigest: request.contentDigest,
		contentRepresentation: 'uncompressed-xdr',
		derivationVersion: 1,
		format: 'compact-v2',
		binding: {
			remoteId: request.remoteId,
			executionId: request.executionId,
			claimAttempt: request.claimAttempt,
			objectType: 'ledger',
			objectKey: request.objectKey,
			checkpointLedger: 63,
			sourceUrl: 'https://target.example/ledger.xdr.gz'
		},
		summary: {
			entryCount: 64,
			ledgerCount: 64,
			firstLedger: 0,
			lastLedger: 63,
			headerHashesVerified: true
		}
	};
}

function transport(data: unknown, status = 200) {
	const http = mock<HttpService>();
	http.post.mockResolvedValue(
		ok({ data, status, statusText: 'OK', headers: {} })
	);
	return http;
}
