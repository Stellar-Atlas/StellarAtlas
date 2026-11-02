/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isArchiveRadarResponse, type ArchiveRadarResponse, type KnownArchiveRemoteFailurePageV1 } from 'shared';
import { ArchiveRadarObservationPanel, ObservationResult } from '../archive-radar-observation';

const root = 'https://history.example.com/History', stamp = '2026-02-01T00:00:00Z';
const failures: KnownArchiveRemoteFailurePageV1 = { filters: { archiveUrlIdentity: root, objectType: null }, failures: [], hasMore: true, limit: 10, nextCursor: 'cursor', snapshotAt: stamp, total: 11 };
const loaded: ArchiveRadarResponse = { schemaVersion: 1, archiveUrl: root, source: 'withobsrvr-radar', status: 'loaded', errorCode: null, lookupAt: stamp, servedAt: stamp, cached: false,
	observation: { fetchedAt: stamp, contentHashSha256: 'a'.repeat(64), scanStartedAt: '2025-01-01T00:00:00Z', scanEndedAt: '2025-01-01T00:01:00Z', hasError: true, errorObjectUrl: root + '/ledger.xdr.gz', attribution: 'unclassified', checkpointScope: 'unknown', findingCoverage: 'unknown' } };
const render = (result = loaded, page = failures): string => renderToStaticMarkup(createElement(ObservationResult, { root, result, failures: page }));

describe('Radar beside already-loaded archive evidence', () => {
	it('renders an explicit initial action without loading a source or inventing a result', () => {
		const html = renderToStaticMarkup(createElement(ArchiveRadarObservationPanel, { archiveUrl: root, failures }));
		expect(html).toContain('Check Radar observation'); expect(html).toContain('Radar has not been requested'); expect(html).not.toContain('Reported by Radar');
	});
	it('preserves old scan times and partial/unknown-coverage warnings', () => {
		const html = render(); expect(html).toContain('2025-01-01T00:00:00Z'); expect(html).toContain('2026-02-01T00:00:00Z');
		expect(html).toContain('Reported by Radar'); expect(html).toContain('The Atlas page is partial'); expect(html).toContain('not definitive missed errors'); expect(html).toContain('Freshness policy is not configured'); expect(html).toContain('Worker issues remain separate');
	});
	it.each(['not_found', 'unavailable'] as const)('retains lookup time on cached null %s and never calls it clean', status => {
		const dto: ArchiveRadarResponse = { ...loaded, status, errorCode: status === 'unavailable' ? 'upstream_http' : null, observation: null, cached: true, servedAt: '2026-02-01T00:00:01Z' };
		expect(isArchiveRadarResponse(dto)).toBe(true);
		const html = render(dto); expect(html).toContain('Original lookup: 2026-02-01T00:00:00Z (cached)'); expect(html).toContain('not a clean scan'); expect(html).not.toContain('Reported by Radar');
	});
	it('does not render a foreign result or compare a foreign Atlas page', () => {
		expect(render({ ...loaded, archiveUrl: 'https://other.example' })).not.toContain('ledger.xdr.gz');
		expect(render(loaded, { ...failures, filters: { ...failures.filters, archiveUrlIdentity: 'https://other.example' } })).toContain('its rows are not compared');
	});
	it('rejects unsafe roots and unknown or contradictory public response fields', () => {
		expect(renderToStaticMarkup(createElement(ArchiveRadarObservationPanel, { archiveUrl: 'https://user:password@history.example', failures }))).toBe('');
		for (const value of [{ ...loaded, extra: 'private' }, { ...loaded, archiveUrl: root + '?token=x' }, { ...loaded, status: 'unavailable' }, { ...loaded, observation: { ...loaded.observation, errorObjectUrl: 'https://other.example/file' } }]) expect(isArchiveRadarResponse(value)).toBe(false);
	});
});
