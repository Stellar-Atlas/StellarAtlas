import { expect, it, jest } from '@jest/globals';
import { loadSubmissionCapability, parseSavedSubmission, readDeveloperSubmission, saveDeveloperSubmission,
	readDeveloperSubmissionId, submissionInput } from '../developer-submissions';

const input = { contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4', repository: 'owner/repo', commit: 'a'.repeat(40) };
const id = '12345678-1234-4234-8234-123456789abc';
const signal = new AbortController().signal;
const saved = (status = 'checking', result: unknown = null) => ({ id,
	submittedAt: '2026-11-15T12:00:00.000Z', expiresAt: '2026-12-15T12:00:00.000Z',
	networkPassphrase: 'Public Global Stellar Network ; September 2015', request: input, status, result,
	contractOwnership: 'not_assessed', independentReproduction: 'not_assessed', securityAudit: 'not_assessed' });
const evidence = () => ({ contractId: input.contractId, networkPassphrase: saved().networkPassphrase,
	observedLedger: 65_000_001, checkedAt: saved().submittedAt, wasmSha256: 'b'.repeat(64),
	build: { status: 'verified', record: { repository: input.repository, commit: input.commit } } });

it('admits saved requests independently of GitHub sign-in capability', async () => {
	const send = jest.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 }))
		.mockResolvedValueOnce(Response.json({ available: true, verification: 'published_build_attestation', retentionDays: 30 }));
	expect(await loadSubmissionCapability(signal, send)).toEqual({ kind: 'disabled' });
	expect(await loadSubmissionCapability(signal, send)).toEqual({ kind: 'available', retentionDays: 30 });
	expect(send).toHaveBeenCalledWith('/v1/developer-auth/submissions/capabilities', expect.objectContaining({
		credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal
	}));
});

it('validates exact source and contract inputs without accepting URLs or branches', () => {
	expect(readDeveloperSubmissionId(id)).toBe(id);
	expect(readDeveloperSubmissionId([id])).toBeNull();
	expect(readDeveloperSubmissionId('https://other.example/' + id)).toBeNull();
	expect(submissionInput(input)).toEqual(input);
	expect(submissionInput({ ...input, repository: 'Owner/Repo' })?.repository).toBe('owner/repo');
	for (const invalid of [{ ...input, contractId: 'C'.repeat(56) }, { ...input, repository: 'https://github.com/owner/repo' },
		{ ...input, repository: 'owner/..' }, { ...input, commit: 'main' }]) expect(submissionInput(invalid)).toBeNull();
});

it('sends only exact request fields and the same idempotency key on manual retries, with no arbitrary abort timeout', async () => {
	const send = jest.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('connection lost'))
		.mockResolvedValueOnce(Response.json(saved(), { status: 200 }));
	expect(await saveDeveloperSubmission(input, id, signal, send)).toEqual({ kind: 'unavailable' });
	expect((await saveDeveloperSubmission(input, id, signal, send)).kind).toBe('saved');
	expect(send).toHaveBeenCalledTimes(2);
	for (const call of send.mock.calls) expect(call).toEqual(['/v1/developer-auth/submissions', {
		method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
		headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(input)
	}]);
	const invalid = jest.fn<typeof fetch>();
	expect(await saveDeveloperSubmission(input, 'bad-key', signal, invalid)).toEqual({ kind: 'invalid' });
	expect(invalid).not.toHaveBeenCalled();
});

it('uses owner-only reads, preserves Retry-After, and distinguishes session, origin and conflict failures', async () => {
	const send = jest.fn<typeof fetch>().mockResolvedValueOnce(Response.json(saved()))
		.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '90' } }))
		.mockResolvedValueOnce(new Response(null, { status: 401 }))
		.mockResolvedValueOnce(new Response(null, { status: 403 }))
		.mockResolvedValueOnce(new Response(null, { status: 409 }))
		.mockResolvedValueOnce(new Response(null, { status: 404 }));
	expect((await readDeveloperSubmission(id, signal, send)).kind).toBe('saved');
	expect(send).toHaveBeenNthCalledWith(1, '/v1/developer-auth/submissions/' + id, expect.objectContaining({ signal, cache: 'no-store', credentials: 'same-origin' }));
	const before = Date.now();
	const busy = await saveDeveloperSubmission(input, id, signal, send);
	expect(busy.kind).toBe('busy');
	if (busy.kind === 'busy') expect(busy.retryAt).toBeGreaterThanOrEqual(before + 90_000);
	for (const kind of ['signed-out', 'wrong-origin', 'conflict', 'not-found'])
		expect((await readDeveloperSubmission(id, signal, send)).kind).toBe(kind);
});

it('never promotes completion, a source mismatch or malformed evidence into a verified build', async () => {
	expect(parseSavedSubmission(saved('completed', { status: 'source_mismatch', evidence: evidence() }))?.result?.status).toBe('source_mismatch');
	expect(parseSavedSubmission(saved('completed', { status: 'verified', evidence: evidence() }))?.result?.status).toBe('verified');
	for (const invalid of [
		saved('completed', { status: 'verified', evidence: null }),
		saved('completed', { status: 'verified', evidence: { ...evidence(), contractId: 'wrong' } }),
		saved('completed', { status: 'verified', evidence: { ...evidence(), build: { status: 'verified', record: { repository: 'other/repo', commit: input.commit } } } }),
		{ ...saved(), contractOwnership: 'verified' }, { ...saved(), securityAudit: 'passed' }
	]) expect(parseSavedSubmission(invalid)).toBeNull();
	const send = jest.fn<typeof fetch>().mockResolvedValue(Response.json({ ...saved(), id: '87654321-1234-4234-8234-123456789abc' }));
	expect(await readDeveloperSubmission(id, signal, send)).toEqual({ kind: 'unavailable' });
});
