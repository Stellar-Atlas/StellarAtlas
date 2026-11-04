/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { radarArchiveReportUrl, radarValidatorUrl } from '@domain/radar-links';
import {
	isArchiveRadarResponse,
	type ArchiveRadarResponse,
	type KnownArchiveRemoteFailurePageV1
} from 'shared';
import {
	ArchiveRadarObservationPanel,
	ObservationResult
} from '../archive-radar-observation';

const root = 'https://history.example.com/History',
	stamp = '2026-02-01T00:00:00Z';
const failures: KnownArchiveRemoteFailurePageV1 = {
	filters: { archiveUrlIdentity: root, objectType: null },
	failures: [],
	hasMore: true,
	limit: 10,
	nextCursor: 'cursor',
	snapshotAt: stamp,
	total: 11
};
const loaded: ArchiveRadarResponse = {
	schemaVersion: 1,
	archiveUrl: root,
	source: 'withobsrvr-radar',
	status: 'loaded',
	errorCode: null,
	lookupAt: stamp,
	servedAt: stamp,
	cached: false,
	observation: {
		fetchedAt: stamp,
		contentHashSha256: 'a'.repeat(64),
		scanStartedAt: '2025-01-01T00:00:00Z',
		scanEndedAt: '2025-01-01T00:01:00Z',
		hasError: true,
		errorObjectUrl: root + '/ledger.xdr.gz',
		attribution: 'unclassified',
		checkpointScope: 'unknown',
		findingCoverage: 'unknown'
	}
};
const render = (result = loaded, page = failures): string =>
	renderToStaticMarkup(
		createElement(ObservationResult, { root, result, failures: page })
	);

describe('Radar beside already-loaded archive evidence', () => {
	it('keeps a reversed source scan window explicitly invalid', () => {
		if (loaded.observation === null) throw new Error('Expected fixture observation');
		expect(render({ ...loaded, observation: { ...loaded.observation, scanStartedAt: '2026-03-01T00:00:00Z' } })).toContain('Radar scan window is invalid');
	});
	it('renders an explicit initial action without loading a source or inventing a result', () => {
		const html = renderToStaticMarkup(
			createElement(ArchiveRadarObservationPanel, {
				archiveUrl: root,
				failures
			})
		);
		expect(html).toContain('Check Radar observation');
		expect(html).toContain('Radar has not been requested');
		expect(html).not.toContain('Reported by Radar');
		expect(html).toContain(
			'<a href="https://radar.withobsrvr.com/api/v1/history-scan/https%3A%2F%2Fhistory.example.com%2FHistory" rel="noreferrer">View on Radar (JSON)</a>'
		);
	});
	it('links exact archive and validator identities, never inferred from names', () => {
		expect(radarArchiveReportUrl('http://history.stellar.org/prd/core-live/core_live_001/')).toBe(
			'https://radar.withobsrvr.com/api/v1/history-scan/http%3A%2F%2Fhistory.stellar.org%2Fprd%2Fcore-live%2Fcore_live_001'
		);
		const publicKey = 'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH';
		expect(radarValidatorUrl({ publicKey, isValidator: true })).toBe(
			'https://radar.withobsrvr.com/nodes/' + publicKey
		);
		expect(radarValidatorUrl({ publicKey, isValidator: false })).toBeNull();
		expect(radarValidatorUrl({ publicKey: publicKey.slice(0, -1) + 'A', isValidator: true })).toBeNull();
		expect(radarValidatorUrl(null)).toBeNull();
	});
	it('omits unsafe or missing archive mappings', () => {
		for (const archiveUrl of [
			'', '//example.com/History', 'javascript:alert(1)',
			'https://example.com@archive.example/History',
			'https://example.com/History?token=not-public',
			'https://example.com/History#other',
			'https://example.com/' + 'ü'.repeat(400)
		]) {
			expect(radarArchiveReportUrl(archiveUrl)).toBeNull();
			expect(renderToStaticMarkup(createElement(ArchiveRadarObservationPanel, {
				archiveUrl, failures
			}))).not.toContain('View on Radar');
		}
		const href = radarArchiveReportUrl('https://example.com/A%2FB');
		expect(href).toBe('https://radar.withobsrvr.com/api/v1/history-scan/https%3A%2F%2Fexample.com%2FA%252FB');
	});
	it('preserves old scan times and partial/unknown-coverage warnings', () => {
		const html = render();
		expect(html).toContain('2025-01-01T00:00:00Z');
		expect(html).toContain('2026-02-01T00:00:00Z');
		expect(html).toContain('Reported by Radar');
		expect(html).toContain('The Atlas page is partial');
		expect(html).toContain('not definitive missed errors');
		expect(html).toContain('Freshness policy is not configured');
		expect(html).toContain('Worker issues remain separate');
	});
	it.each(['not_found', 'unavailable'] as const)(
		'retains lookup time on cached null %s and never calls it clean',
		(status) => {
			const dto: ArchiveRadarResponse = {
				...loaded,
				status,
				errorCode: status === 'unavailable' ? 'upstream_http' : null,
				observation: null,
				cached: true,
				servedAt: '2026-02-01T00:00:01Z'
			};
			expect(isArchiveRadarResponse(dto)).toBe(true);
			const html = render(dto);
			expect(html).toContain('Original lookup: 2026-02-01T00:00:00Z (cached)');
			expect(html).toContain('not a clean scan');
			expect(html).not.toContain('Reported by Radar');
		}
	);
	it('does not render a foreign result or compare a foreign Atlas page', () => {
		expect(
			render({ ...loaded, archiveUrl: 'https://other.example' })
		).not.toContain('ledger.xdr.gz');
		expect(
			render(loaded, {
				...failures,
				filters: {
					...failures.filters,
					archiveUrlIdentity: 'https://other.example'
				}
			})
		).toContain('its rows are not compared');
	});
	it('labels shared and one-sided object reports without claiming an exhaustive comparison', () => {
		const copies = {
			count: null,
			copies: [],
			lookupStatus: 'not_requested' as const,
			sampleLimit: 0
		};
		const object = {
			archiveUrl: root,
			archiveUrlIdentity: root,
			objectKey: 'ledger/127',
			objectType: 'ledger' as const,
			objectUrl: root + '/ledger.xdr.gz',
			remoteId: 'remote',
			status: 'failed' as const,
			workerStage: null,
			checkpointLedger: 127,
			bucketHash: null,
			bytesDownloaded: null,
			attempts: 1,
			delayReason: null,
			nextAttemptAt: null,
			refreshAfter: null,
			claimedAt: null,
			updatedAt: stamp,
			verificationFacts: null,
			verifiedAt: null,
			error: {
				type: 'invalid_ledger_hash',
				message: 'Never render the raw diagnostic',
				httpStatus: 200
			}
		};
		const row = {
			object,
			networkVerifiedCopies: copies,
			sameOrganizationVerifiedCopies: copies
		};
		const html = render(loaded, {
			...failures,
			failures: [
				row,
				{
					...row,
					object: {
						...object,
						remoteId: 'second',
						objectUrl: root + '/other.xdr.gz'
					}
				}
			]
		});
		expect(html).toContain('Reported by both sources');
		expect(html).toContain('Reported by Atlas');
		expect(html).toContain('checkpoint 127');
		expect(html).toContain('not definitive missed errors');
		expect(html).not.toContain('Never render the raw diagnostic');
		const wrongRoot = render(loaded, {
			...failures,
			failures: [
				{
					...row,
					object: { ...object, archiveUrlIdentity: 'https://foreign.example' }
				}
			]
		});
		expect(wrongRoot).not.toContain('Reported by both sources');
	});
	it('rejects unsafe roots and unknown or contradictory public response fields', () => {
		expect(
			renderToStaticMarkup(
				createElement(ArchiveRadarObservationPanel, {
					archiveUrl: 'https://user:password@history.example',
					failures
				})
			)
		).toBe('');
		for (const value of [
			{ ...loaded, extra: 'private' },
			{ ...loaded, archiveUrl: root + '?token=x' },
			{ ...loaded, status: 'unavailable' },
			{
				...loaded,
				observation: {
					...loaded.observation,
					errorObjectUrl: 'https://other.example/file'
				}
			}
		])
			expect(isArchiveRadarResponse(value)).toBe(false);
	});
});
