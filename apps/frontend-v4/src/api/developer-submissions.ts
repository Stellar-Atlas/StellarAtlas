import { isContractAccount } from '../domain/classic-account';

const prefix = '/v1/developer-auth/submissions';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const statuses = ['verified', 'not_published', 'metadata_missing', 'metadata_invalid',
	'unsupported', 'invalid', 'unavailable', 'builtin', 'not_found_at_ledger', 'source_mismatch'] as const;
export type SubmissionStatus = typeof statuses[number];
export type SubmissionInput = { readonly contractId: string; readonly repository: string; readonly commit: string };
export type SubmissionEvidence = {
	readonly observedLedger: number;
	readonly checkedAt: string;
	readonly wasmSha256: string | null;
	readonly source: { readonly repository: string; readonly commit: string } | null;
};
export type SavedSubmission = {
	readonly id: string;
	readonly submittedAt: string;
	readonly expiresAt: string;
	readonly networkPassphrase: string;
	readonly request: SubmissionInput;
	readonly status: 'checking' | 'completed' | 'unavailable';
	readonly result: { readonly status: SubmissionStatus; readonly evidence: SubmissionEvidence | null } | null;
};
export type SubmissionError = {
	readonly kind: 'unavailable' | 'disabled' | 'signed-out' | 'wrong-origin' | 'invalid' | 'conflict' | 'not-found' | 'busy';
	readonly retryAt?: number;
};
export type SubmissionResponse = { readonly kind: 'saved'; readonly submission: SavedSubmission } | SubmissionError;
export type SubmissionCapability = { readonly kind: 'available'; readonly retentionDays: number }
	| { readonly kind: 'disabled' } | { readonly kind: 'unavailable' };

export function readDeveloperSubmissionId(value: unknown): string | null {
	return typeof value === 'string' && uuid.test(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function repository(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value)
		&& !['.', '..'].includes(value.split('/')[1]!);
}
function timestamp(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function submissionInput(value: unknown): SubmissionInput | null {
	const row = record(value);
	if (typeof row.contractId !== 'string' || !isContractAccount(row.contractId) || !repository(row.repository)
		|| typeof row.commit !== 'string' || !commitPattern.test(row.commit)) return null;
	return { contractId: row.contractId, repository: row.repository.toLowerCase(), commit: row.commit };
}

export function parseSavedSubmission(value: unknown): SavedSubmission | null {
	const row = record(value), input = submissionInput(row.request);
	if (!input || typeof row.id !== 'string' || !uuid.test(row.id) || !timestamp(row.submittedAt)
		|| !timestamp(row.expiresAt) || Date.parse(row.expiresAt) <= Date.parse(row.submittedAt)
		|| typeof row.networkPassphrase !== 'string' || !row.networkPassphrase || row.networkPassphrase.length > 200
		|| !['checking', 'completed', 'unavailable'].includes(String(row.status))
		|| row.contractOwnership !== 'not_assessed' || row.independentReproduction !== 'not_assessed'
		|| row.securityAudit !== 'not_assessed') return null;
	let result: SavedSubmission['result'] = null;
	if (row.status === 'checking') {
		if (row.result !== null) return null;
	} else {
		const item = record(row.result);
		if (!statuses.includes(item.status as SubmissionStatus)) return null;
		let evidence: SubmissionEvidence | null = null;
		if (item.evidence !== null) {
			const data = record(item.evidence), build = record(data.build), source = record(build.record);
			if (data.contractId !== input.contractId || data.networkPassphrase !== row.networkPassphrase
				|| !Number.isSafeInteger(data.observedLedger) || Number(data.observedLedger) <= 0
				|| !timestamp(data.checkedAt) || !statuses.includes(build.status as SubmissionStatus)
				|| (data.wasmSha256 !== null && (typeof data.wasmSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.wasmSha256)))) return null;
			if (item.status !== build.status && !(item.status === 'source_mismatch' && build.status === 'verified')) return null;
			const identity = repository(source.repository) && typeof source.commit === 'string' && commitPattern.test(source.commit)
				? { repository: source.repository.toLowerCase(), commit: source.commit } : null;
			if (item.status === 'verified' && (build.status !== 'verified' || !data.wasmSha256
				|| identity?.repository !== input.repository || identity.commit !== input.commit)) return null;
			evidence = { observedLedger: Number(data.observedLedger), checkedAt: data.checkedAt,
				wasmSha256: data.wasmSha256 as string | null, source: identity };
		} else if (item.status === 'verified') return null;
		if (row.status === 'unavailable' && item.status !== 'unavailable') return null;
		result = { status: item.status as SubmissionStatus, evidence };
	}
	return { id: row.id, submittedAt: row.submittedAt, expiresAt: row.expiresAt, networkPassphrase: row.networkPassphrase,
		request: input, status: row.status as SavedSubmission['status'], result };
}

function options(signal: AbortSignal): RequestInit {
	return { credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
		headers: { Accept: 'application/json' } };
}
export async function loadSubmissionCapability(signal: AbortSignal, send: typeof fetch = fetch): Promise<SubmissionCapability> {
	try {
		const response = await send(prefix + '/capabilities', options(signal));
		if (response.status === 404) return { kind: 'disabled' };
		if (response.status !== 200) return { kind: 'unavailable' };
		const value = record(await response.json());
		return value.available === true && value.verification === 'published_build_attestation'
			&& value.retentionDays === 30 ? { kind: 'available', retentionDays: 30 } : { kind: 'unavailable' };
	} catch { return { kind: 'unavailable' }; }
}

async function failure(response: Response): Promise<SubmissionError> {
	if (response.status === 429) {
		const header = response.headers.get('Retry-After');
		const deadline = header && /^\d+$/.test(header) ? Date.now() + Number(header) * 1000 : Date.parse(header ?? '');
		return { kind: 'busy', retryAt: Number.isFinite(deadline) ? Math.max(Date.now() + 1000, deadline) : Date.now() + 60_000 };
	}
	return { kind: response.status === 401 ? 'signed-out' : response.status === 403 ? 'wrong-origin'
		: response.status === 404 ? 'not-found' : response.status === 409 ? 'conflict'
			: response.status === 400 || response.status === 413 ? 'invalid' : 'unavailable' };
}

export async function saveDeveloperSubmission(input: SubmissionInput, key: string, signal: AbortSignal,
	send: typeof fetch = fetch): Promise<SubmissionResponse> {
	if (!submissionInput(input) || !uuid.test(key)) return { kind: 'invalid' };
	try {
		const response = await send(prefix, { ...options(signal), method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key },
			body: JSON.stringify(input) });
		if (response.status !== 200 && response.status !== 201) return failure(response);
		const saved = parseSavedSubmission(await response.json());
		return saved && saved.request.contractId === input.contractId && saved.request.commit === input.commit
			&& saved.request.repository === input.repository.toLowerCase() ? { kind: 'saved', submission: saved } : { kind: 'unavailable' };
	} catch { return { kind: 'unavailable' }; }
}

export async function readDeveloperSubmission(id: string, signal: AbortSignal, send: typeof fetch = fetch): Promise<SubmissionResponse> {
	if (!uuid.test(id)) return { kind: 'invalid' };
	try {
		const response = await send(prefix + '/' + id, options(signal));
		if (response.status !== 200) return failure(response);
		const saved = parseSavedSubmission(await response.json());
		return saved?.id === id ? { kind: 'saved', submission: saved } : { kind: 'unavailable' };
	} catch { return { kind: 'unavailable' }; }
}
