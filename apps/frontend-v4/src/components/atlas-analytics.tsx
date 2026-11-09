'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { parse as parsePublicSuffix } from 'tldts';
import contract from '../../../../ops/analytics/traffic-contract.json';

const events = {
	docs: { name: 'Documentation use', url: 'https://stellaratlas.io/docs' },
	archives: { name: 'Archive inspection', url: 'https://stellaratlas.io/archives' },
	network: { name: 'Network view', url: 'https://stellaratlas.io/overview' },
	explorerList: { name: 'Explorer list view', url: 'https://stellaratlas.io/explorer' },
	explorerRecord: { name: 'Explorer record view', url: 'https://stellaratlas.io/explorer' },
	explorerSearch: { name: 'Explorer search submitted', url: 'https://stellaratlas.io/explorer' }
} as const;
type AtlasEvent = keyof typeof events;
const website = 'https://stellaratlas.io';
const preferenceKey = 'plausible_ignore';
const preferenceEvent = 'stellaratlas-analytics-preference';
const pending = new Set<AbortController>();
let preferenceOverride: boolean | undefined;

function globalPrivacyControl(): boolean {
	return typeof navigator !== 'undefined' && 'globalPrivacyControl' in navigator &&
		navigator.globalPrivacyControl === true;
}

export function atlasAnalyticsOptedOut(): boolean {
	if (globalPrivacyControl()) return true;
	if (preferenceOverride !== undefined) return preferenceOverride;
	try { return typeof localStorage !== 'undefined' && localStorage.getItem(preferenceKey) === 'true'; }
	catch { return false; }
}

function abortOptedOutSends(): void {
	if (atlasAnalyticsOptedOut()) for (const request of pending) request.abort();
}

export function setAtlasAnalyticsOptOut(optOut: boolean): void {
	preferenceOverride = optOut;
	try {
		if (optOut) localStorage.setItem(preferenceKey, 'true');
		else localStorage.removeItem(preferenceKey);
		preferenceOverride = undefined;
	} catch { /* Keep the tab preference if storage is unavailable. */ }
	abortOptedOutSends();
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(preferenceEvent));
}

function subscribePreference(changed: () => void): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key !== preferenceKey && event.key !== null) return;
		preferenceOverride = undefined;
		abortOptedOutSends();
		changed();
	};
	window.addEventListener('storage', onStorage);
	window.addEventListener(preferenceEvent, changed);
	return () => {
		window.removeEventListener('storage', onStorage);
		window.removeEventListener(preferenceEvent, changed);
	};
}

function sendEvent(payload: { readonly name: string; readonly url: string; readonly referrer?: string }): void {
	const configured = process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN;
	if (!configured || pending.size >= 8 || typeof navigator === 'undefined' || atlasAnalyticsOptedOut()) return;
	try {
		const origin = new URL(configured);
		if (origin.protocol !== 'https:' || origin.origin !== configured) return;
		const controller = new AbortController();
		const request = fetch(new URL('/api/event', origin), {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: JSON.stringify({ ...payload, domain: 'stellaratlas.io' }),
			mode: 'cors',
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			redirect: 'error',
			signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
		});
		pending.add(controller);
		void request.catch(() => {}).finally(() => { pending.delete(controller); });
	} catch {
		// Analytics is optional.
	}
}

export function recordAtlasView(event: AtlasEvent): void {
	if (Object.hasOwn(events, event)) sendEvent(events[event]);
}

const explorerRecords = new Set([
	'accounts', 'assets', 'contracts', 'issuers', 'ledgers', 'liquidity-pools',
	'operations', 'transactions', 'offers', 'trades'
]);
const explorerLists = new Set([
	'assets', 'contracts', 'issuers', 'liquidity-pools', 'operations',
	'transactions', 'offers', 'trades', 'transfers', 'contract-events',
	'markets', 'verified-contracts', 'soroban-domains'
]);

export function atlasRouteEvent(pathname: string): AtlasEvent | null {
	const [, section, family, record, extra] = pathname.replace(/\/$/, '').split('/', 5);
	if (pathname === '/' || (section === 'overview' && family === undefined) ||
		((section === 'nodes' || section === 'organizations') && record === undefined))
		return 'network';
	if (section !== 'explorer') return null;
	if (family === undefined || (record === undefined && explorerLists.has(family)))
		return 'explorerList';
	if (family === 'issuers' && record === 'by-domain' && extra === undefined) return 'explorerList';
	if (extra === undefined && record && explorerRecords.has(family)) return 'explorerRecord';
	return null;
}

const publicPageLabels = new Set(contract.paths);
const referralHostname = new RegExp(contract.referrerPolicy.hostnamePattern);
const opaqueReferralLabel = new RegExp(contract.referrerPolicy.opaqueLabelPattern);

export function atlasPageLabel(pathname: string): string | undefined {
	if (!pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#')) return;
	const path = pathname === '/' ? pathname : pathname.replace(/\/$/, '');
	if (publicPageLabels.has(path)) return path;
	const [, section, first, second, extra] = path.split('/', 5);
	if (!first) return;
	if (section === 'archive-scans') return '/archive-scans/_detail';
	if ((section === 'nodes' || section === 'organizations') && second === undefined)
		return '/' + section + '/_detail';
	if (section === 'docs') {
		if (first === 'api' && second && extra === undefined) return '/docs/api/_operation';
		if (second === undefined) return '/docs/_guide';
	}
	if (section === 'explorer' && second && extra === undefined && explorerRecords.has(first))
		return '/explorer/' + first + '/_detail';
}

export function atlasSafeReferrer(value: string): string | undefined {
	if (value.length > 8192) return;
	try {
		const source = new URL(value);
		if ((source.protocol !== 'https:' && source.protocol !== 'http:') ||
			source.username || source.password || source.port) return;
		const host = source.hostname.replace(/\.$/, '');
		if (!referralHostname.test(host)) return;
		const { domain, isIcann, isIp } = parsePublicSuffix(host, { allowPrivateDomains: false });
		if (!domain || isIcann !== true || isIp || opaqueReferralLabel.test(domain) ||
			contract.referrerPolicy.excludedSuffixes.some(suffix => domain === suffix || domain.endsWith('.' + suffix)))
			return;
		return source.protocol + '//' + domain;
	} catch { /* Missing or invalid referrers have no attribution. */ }
}

export function recordAtlasPageview(pathname: string, referrer: string): void {
	const path = atlasPageLabel(pathname);
	if (!path) return;
	const source = atlasSafeReferrer(referrer);
	sendEvent({ name: 'pageview', url: website + path, ...(source ? { referrer: source } : {}) });
}

export function AtlasRouteAnalytics(): null {
	const pathname = usePathname();
	const previous = useRef<string | null>(null);
	useEffect(() => {
		const previousPath = previous.current;
		if (pathname === previousPath) return;
		const previousAction = previousPath === null ? null : atlasRouteEvent(previousPath);
		previous.current = pathname;
		if (pathname === null) return;
		recordAtlasPageview(pathname, previousPath === null ? document.referrer : '');
		const action = atlasRouteEvent(pathname);
		if (action && action !== previousAction) recordAtlasView(action);
	}, [pathname]);
	useEffect(() => subscribePreference(abortOptedOutSends), []);
	return null;
}

export function AtlasAnalyticsPreference(): React.JSX.Element | null {
	const optedOut = useSyncExternalStore(subscribePreference, atlasAnalyticsOptedOut, () => false);
	const gpc = useSyncExternalStore(subscribePreference, globalPrivacyControl, () => false);
	if (!process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN) return null;
	return (
		<label className="atlas-analytics-preference">
			<input type="checkbox" checked={!optedOut} disabled={gpc}
				onChange={event => setAtlasAnalyticsOptOut(!event.currentTarget.checked)} />
			{gpc ? 'Usage analytics off (browser privacy setting)' : 'Allow usage analytics'}
		</label>
	);
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
