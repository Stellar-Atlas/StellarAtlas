'use client';

import { useEffect, useRef, useState } from 'react';
import { archiveRadarHttpStatus, archiveRadarObjectUrl, isArchiveRadarResponse, publicArchiveRootIdentity, type ArchiveRadarResponse } from 'shared';
import type { PublicKnownArchiveEvidence } from '@domain/known-archive-evidence';
import { buildBrowserApiUrl } from '@api/browser-client';

type FailurePage = PublicKnownArchiveEvidence['remoteFailures'];

export function ArchiveRadarObservationPanel({ archiveUrl, failures }: {
	readonly archiveUrl: string;
	readonly failures: FailurePage;
}): React.JSX.Element | null {
	const root = publicArchiveRootIdentity(archiveUrl);
	return root === null ? null : <RadarObservation key={root} root={root} failures={failures} />;
}

function RadarObservation({ root, failures }: { readonly root: string; readonly failures: FailurePage }): React.JSX.Element {
	const [state, setState] = useState<ArchiveRadarResponse | 'loading' | 'failed' | null>(null);
	const pending = useRef<AbortController | null>(null);
	useEffect(() => () => { pending.current?.abort(); }, []);
	const load = async (): Promise<void> => {
		if (pending.current) return;
		const controller = new AbortController(); pending.current = controller; setState('loading');
		try {
			const response = await fetch(buildBrowserApiUrl(`/v2/archive-scans/${encodeURIComponent(root)}/radar-observation`), {
				headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
			});
			const body = await readObservationResponse(response);
			if (!isArchiveRadarResponse(body) || body.archiveUrl !== root || response.status !== archiveRadarHttpStatus(body)) throw new Error('Invalid observation');
			if (!controller.signal.aborted) setState(body);
		} catch { if (!controller.signal.aborted) setState('failed'); }
		finally { if (pending.current === controller) pending.current = null; }
	};
	return <section className="archive-source-findings" aria-label="Radar archive observation">
		<h3>Radar archive observation</h3>
		<p>Compare an external observation with the Atlas evidence already loaded here. No additional Atlas evidence is requested.</p>
		<button type="button" disabled={state === 'loading'} onClick={() => { void load(); }}>
			{state === 'loading' ? 'Loading Radar observation…' : state === null ? 'Check Radar observation' : 'Check Radar again'}
		</button>
		<div role="status" aria-live="polite">
			{state === null ? <p>Radar has not been requested.</p> : state === 'loading' ? <p>Waiting for Radar; existing Atlas evidence is unchanged.</p> : state === 'failed' ? <p>Radar observation unavailable. No conclusion about archive health can be drawn. You can retry manually.</p> : <ObservationResult root={root} result={state} failures={failures} />}
		</div>
	</section>;
}

async function readObservationResponse(response: Response): Promise<unknown> {
	if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
		await response.body?.cancel(); throw new Error('Invalid response');
	}
	const reader = response.body.getReader(); let bytes = 0, text = ''; const decoder = new TextDecoder();
	try {
		while (true) {
			const chunk = await reader.read(); if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > 8192) { await reader.cancel(); throw new Error('Response limit'); }
			text += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode()) as unknown;
	} finally { reader.releaseLock(); }
}

export function ObservationResult({ root, result, failures }: {
	readonly root: string; readonly result: ArchiveRadarResponse; readonly failures: FailurePage;
}): React.JSX.Element {
	if (result.archiveUrl !== root) return <p>Observation belongs to a different archive.</p>;
	const observation = result.observation;
	const atlasMatches = publicArchiveRootIdentity(failures.filters.archiveUrlIdentity ?? '') === root;
	const atlasRows = atlasMatches ? failures.failures.slice(0, 10).filter(row =>
		publicArchiveRootIdentity(row.object.archiveUrlIdentity) === root && publicArchiveRootIdentity(row.object.archiveUrl) === root) : [];
	const radarUrl = observation?.hasError ? observation.errorObjectUrl : null;
	const atlasUrls = new Set(atlasRows.map(row => archiveRadarObjectUrl(row.object.objectUrl, root)).filter(url => url !== null));
	const shared = radarUrl !== null && atlasUrls.has(radarUrl);
	return <>
		<p>Radar status: {result.status}{result.errorCode ? ` (${result.errorCode})` : ''}. Original lookup: {result.lookupAt ?? 'not performed'}{result.cached ? ' (cached)' : ''}. Response served: {result.servedAt}.</p>
		{observation ? <>
			<p>Radar scan: {observation.scanStartedAt} to {observation.scanEndedAt}; fetched {observation.fetchedAt}. Freshness policy is not configured; a recent fetch does not imply a recent scan.</p>
			<p>Radar checkpoint scope and finding coverage are unknown. Radar reports are unclassified, not proof of an archive defect or worker fault.</p>
			{observation.hasError ? <p>{shared ? 'Reported by both sources' : 'Reported by Radar'}: {radarUrl ?? 'No safe object URL was provided'}.</p> : <p>Radar reports no finding in this observation; this does not establish a clean archive.</p>}
		</> : <p>No Radar scan evidence is available. Missing or failed lookup is not a clean scan.</p>}
		<p>Atlas page snapshot: {failures.snapshotAt}. {atlasMatches ? 'Showing at most 10 already-loaded failure rows.' : 'Atlas page identity differs; its rows are not compared.'} {failures.hasMore || failures.nextCursor !== null || failures.total > failures.failures.length ? 'The Atlas page is partial.' : 'A loaded page does not establish complete archive coverage.'}</p>
		{atlasRows.length > 0 ? <ul>{atlasRows.map((row, index) => {
			const url = archiveRadarObjectUrl(row.object.objectUrl, root);
			return <li key={`${row.object.remoteId}-${index}`}>{url !== null && url === radarUrl ? 'Reported by both sources' : 'Reported by Atlas'}: {url ?? 'No safe object URL'}; observed {row.retainedFinding?.observedAt ?? row.object.updatedAt}; checkpoint {row.object.checkpointLedger ?? 'unknown'}; attribution {row.retainedFinding?.failureChannel ?? 'unknown'}.</li>;
		})}</ul> : <p>No Atlas failure row is shown for comparison; absence is not established.</p>}
		<p>These are observed reports, not definitive missed errors. Different observation times, unknown or unequal checkpoint scope, capped pages and worker/setup failures cannot establish absence. Worker issues remain separate in the Atlas view.</p>
	</>;
}
