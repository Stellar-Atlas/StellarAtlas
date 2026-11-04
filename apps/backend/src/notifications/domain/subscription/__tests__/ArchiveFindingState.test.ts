import {
	archiveFinding,
	archiveFindingEligible,
	type ArchiveFindingSnapshot
} from '../ArchiveFindingState.js';
import { HistoryArchiveIntegrityFailureDetectedEvent } from '../../event/Event.js';
import { PublicKey } from '../../event/EventSourceId.js';

const node = PublicKey.create(
	'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH'
);
if (node.isErr()) throw node.error;
const source = node.value;
const first = new Date('2026-11-02T00:00:00.000Z');
function finding(time = first, overrides: Record<string, unknown> = {}) {
	const data = {
		actionId: 'fixture-action',
		archiveUrl: 'https://history.fixture.invalid',
		bucketHash: 'a'.repeat(64),
		checkpointLedger: 63,
		evidenceId: 'fixture-id',
		evidenceObservedAt: time.toISOString(),
		failureCode: 'bucket_hash_mismatch',
		objectKey: 'bucket-a',
		objectType: 'bucket',
		repairPlanPath: '/unused'
	};
	Object.assign(data, overrides);
	return archiveFinding(
		new HistoryArchiveIntegrityFailureDetectedEvent(time, source, data)
	);
}
function state(current = finding()): ArchiveFindingSnapshot {
	return {
		key: current.key,
		observedAt: current.observedAt,
		observedFingerprint: current.fingerprint,
		conflicted: false,
		deliveredFingerprint: finding().fingerprint,
		deliveredObservationAt: first
	};
}

it('excludes time, incidental IDs and raw diagnostics from finding/failure identity', () => {
	const base = finding(),
		later = finding(new Date(first.getTime() + 1), {
			evidenceId: 'other-id',
			actionId: 'other-action',
			errorMessage: 'private diagnostic'
		});
	expect(later.key).toBe(base.key);
	expect(later.fingerprint).toBe(base.fingerprint);
});
it('normalizes structured codes and hash case but distinguishes actual structured changes', () => {
	expect(
		finding(first, {
			failureCode: ' BUCKET-HASH-MISMATCH ',
			bucketHash: 'A'.repeat(64)
		}).fingerprint
	).toBe(finding().fingerprint);
	expect(
		finding(first, { failureCode: 'bucket_verification_failed' }).fingerprint
	).not.toBe(finding().fingerprint);
	expect(finding(first, { bucketHash: 'b'.repeat(64) }).fingerprint).not.toBe(
		finding().fingerprint
	);
	expect(finding(first, { checkpointLedger: 127 }).fingerprint).not.toBe(
		finding().fingerprint
	);
});
it('keeps null semantics explicit and refuses undefined/malformed structured evidence', () => {
	expect(
		finding(first, { bucketHash: null, checkpointLedger: null }).fingerprint
	).not.toBe(finding().fingerprint);
	for (const data of [
		{ bucketHash: undefined },
		{ checkpointLedger: undefined },
		{ checkpointLedger: -1 },
		{ checkpointLedger: 1.5 },
		{ bucketHash: 'bad' },
		{ evidenceObservedAt: 'wrong' }
	])
		expect(() => finding(first, data)).toThrow();
});
it('preserves canonical root identity, path case and private queries without putting them in hashes', () => {
	expect(
		finding(first, { archiveUrl: 'HTTPS://HISTORY.FIXTURE.INVALID///' }).key
	).toBe(finding().key);
	expect(
		finding(first, { archiveUrl: 'https://history.fixture.invalid/A' }).key
	).not.toBe(
		finding(first, { archiveUrl: 'https://history.fixture.invalid/a' }).key
	);
	const privateRoot = finding(first, {
		archiveUrl: 'https://history.fixture.invalid?token=synthetic-only'
	});
	expect(privateRoot.key).toMatch(/^[0-9a-f]{64}$/);
	expect(privateRoot.key).not.toBe(finding().key);
	expect(finding(first, { objectKey: 'bucket-b' }).key).not.toBe(finding().key);
});
it('uses strict greater-than source-observation cooldown equality, never wall-clock age', () => {
	const equal = finding(new Date(first.getTime() + 86_400_000));
	expect(archiveFindingEligible(equal, state(equal), false)).toBe(false);
	const next = finding(new Date(equal.observedAt.getTime() + 1));
	expect(archiveFindingEligible(next, state(next), false)).toBe(true);
	expect(archiveFindingEligible(finding(), state(), false)).toBe(false);
});
it('permits genuine changes and pending source unmute but not stale/conflicted evidence', () => {
	const changed = finding(new Date(first.getTime() + 1), {
		failureCode: 'bucket_verification_failed'
	});
	expect(archiveFindingEligible(changed, state(changed), false)).toBe(true);
	expect(archiveFindingEligible(finding(), state(), true)).toBe(true);
	expect(
		archiveFindingEligible(
			changed,
			{ ...state(changed), conflicted: true },
			true
		)
	).toBe(false);
	expect(archiveFindingEligible(finding(), state(changed), true)).toBe(false);
});
it('retries equal matching evidence with no successful delivery acknowledgement', () => {
	const current = finding();
	expect(
		archiveFindingEligible(
			current,
			{ ...state(), deliveredFingerprint: null, deliveredObservationAt: null },
			false
		)
	).toBe(true);
});
