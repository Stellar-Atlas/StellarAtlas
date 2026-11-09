'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const events = {
	docs: { name: 'Documentation use', url: 'https://stellaratlas.io/docs' },
	archives: { name: 'Archive inspection', url: 'https://stellaratlas.io/archives' },
	network: { name: 'Network view', url: 'https://stellaratlas.io/overview' },
	explorerList: { name: 'Explorer list view', url: 'https://stellaratlas.io/explorer' },
	explorerRecord: { name: 'Explorer record view', url: 'https://stellaratlas.io/explorer' },
	explorerSearch: { name: 'Explorer search submitted', url: 'https://stellaratlas.io/explorer' }
} as const;
type AtlasEvent = keyof typeof events;
const nextSend: Partial<Record<AtlasEvent, number>> = {};
let inFlight = 0;

export function recordAtlasView(event: AtlasEvent): void {
	const configured = process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN;
	if (!configured || inFlight >= 2 || typeof navigator === 'undefined') return;
	try {
		if ('globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true)
			return;
		const origin = new URL(configured);
		if (origin.protocol !== 'https:' || origin.origin !== configured) return;
		if (!Object.hasOwn(events, event)) return;
		const now = performance.now();
		if (now < (nextSend[event] ?? 0)) return;
		const payload = events[event];
		const request = fetch(new URL('/api/event', origin), {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: JSON.stringify({ ...payload, domain: 'stellaratlas.io' }),
			mode: 'cors',
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			redirect: 'error',
			signal: AbortSignal.timeout(2000)
		});
		inFlight++;
		nextSend[event] = now + 3000;
		void request.catch(() => {}).finally(() => { inFlight--; });
	} catch {
		// Analytics is optional.
	}
}

const explorerRecords = new Set([
	'accounts', 'assets', 'contracts', 'issuers', 'ledgers', 'liquidity-pools',
	'operations', 'transactions', 'offers', 'trades'
]);
const explorerLists = new Set([
	'assets', 'contracts', 'issuers', 'liquidity-pools', 'operations',
	'transactions', 'offers', 'trades', 'transfers', 'contract-events'
]);

export function atlasRouteEvent(pathname: string): AtlasEvent | null {
	const [, section, family, record, extra] = pathname.replace(/\/$/, '').split('/', 5);
	if (pathname === '/' || (section === 'overview' && family === undefined) ||
		((section === 'nodes' || section === 'organizations') && record === undefined))
		return 'network';
	if (section !== 'explorer') return null;
	if (family === undefined || (record === undefined && explorerLists.has(family)))
		return 'explorerList';
	if (extra === undefined && record && explorerRecords.has(family)) return 'explorerRecord';
	return null;
}

export function AtlasRouteAnalytics(): null {
	const pathname = usePathname();
	const event = pathname === null ? null : atlasRouteEvent(pathname);
	const previous = useRef<AtlasEvent | null>(null);
	useEffect(() => {
		if (event !== null && previous.current !== event) recordAtlasView(event);
		previous.current = event;
	}, [event]);
	return null;
}

export function AtlasAnalytics({
	event,
	ready = true
}: {
	readonly event: keyof typeof events;
	readonly ready?: boolean;
}): null {
	const recorded = useRef(false);
	useEffect(() => {
		if (ready && !recorded.current) {
			recorded.current = true;
			recordAtlasView(event);
		}
	}, [event, ready]);
	return null;
}
