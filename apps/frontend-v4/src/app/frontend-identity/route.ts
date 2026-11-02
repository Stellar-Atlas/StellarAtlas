const headers = {
	'Content-Type': 'application/json',
	'Cache-Control': 'no-store'
};

/** Frontend identity only; not API readiness or chain completeness. */
export function GET(): Response {
	return new Response(JSON.stringify({
		application: 'stellaratlas-modern-frontend',
		contractVersion: 1
	}), { status: 200, headers });
}

export function HEAD(): Response {
	return new Response(null, { status: 200, headers });
}
