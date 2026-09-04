'use server';

export interface ArchiveObjectRecheckActionResult {
	readonly body: {
		readonly error?: string;
		readonly reason?: string;
		readonly state?: string;
	} | null;
	readonly status: number;
}

interface ArchiveObjectRecheckActionInput {
	readonly evidenceUpdatedAt: string;
	readonly remoteId: string;
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestTimeoutMs = 10_000;

export async function requestArchiveObjectRecheck(
	input: ArchiveObjectRecheckActionInput
): Promise<ArchiveObjectRecheckActionResult> {
	if (
		!uuidPattern.test(input.remoteId) ||
		!Number.isFinite(Date.parse(input.evidenceUpdatedAt))
	) {
		return { body: { error: 'invalid-recheck-request' }, status: 400 };
	}

	const username = process.env.HISTORY_SCAN_API_USERNAME;
	const password = process.env.HISTORY_SCAN_API_PASSWORD;
	if (!username || !password) {
		return { body: { error: 'recheck-service-unavailable' }, status: 503 };
	}

	const apiBaseUrl = (
		process.env.STELLAR_ATLAS_PUBLIC_API_URL ?? 'http://127.0.0.1:3000'
	).replace(/\/+$/, '');
	try {
		const response = await fetch(
			apiBaseUrl +
				'/v1/archive-scans/objects/' +
				encodeURIComponent(input.remoteId) +
				'/recheck',
			{
				body: JSON.stringify({
					minimumEvidenceUpdatedAt: input.evidenceUpdatedAt
				}),
				cache: 'no-store',
				headers: {
					Accept: 'application/json',
					Authorization:
						'Basic ' +
						Buffer.from(username + ':' + password).toString('base64'),
					'Content-Type': 'application/json'
				},
				method: 'POST',
				signal: AbortSignal.timeout(requestTimeoutMs)
			}
		);
		const body = (await response.json().catch(() => null)) as
			ArchiveObjectRecheckActionResult['body'] | null;
		return { body, status: response.status };
	} catch {
		return { body: { error: 'recheck-service-unavailable' }, status: 503 };
	}
}
