'use client';

import { useEffect, useRef } from 'react';

const events = {
	docs: { name: 'Documentation use', url: 'https://stellaratlas.io/docs' },
	archives: { name: 'Archive inspection', url: 'https://stellaratlas.io/archives' }
} as const;
let inFlight = 0;

export function recordAtlasView(event: keyof typeof events): void {
	const configured = process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN;
	if (!configured || inFlight >= 2 || typeof navigator === 'undefined') return;
	try {
		if ('globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true)
			return;
		const origin = new URL(configured);
		if (origin.protocol !== 'https:' || origin.origin !== configured) return;
		if (event !== 'docs' && event !== 'archives') return;
		const payload = events[event];
		const request = fetch(new URL('/api/event', origin), {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: JSON.stringify({ ...payload, domain: 'stellaratlas.io' }),
			mode: 'no-cors',
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			redirect: 'error',
			signal: AbortSignal.timeout(2000)
		});
		inFlight++;
		void request.catch(() => {}).finally(() => { inFlight--; });
	} catch {
		// Analytics is optional.
	}
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
