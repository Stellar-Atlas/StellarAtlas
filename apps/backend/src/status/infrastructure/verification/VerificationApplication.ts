import { parseDirectoryAddress } from '../directory/ExpertDirectoryRecord.js';

export type Network = 'mainnet' | 'testnet';
export type VerificationState =
	'pending' | 'changes_requested' | 'approved' | 'rejected' | 'revoked';
export interface Submission {
	readonly network: Network;
	readonly address: string;
	readonly name: string;
	readonly website: string;
	readonly supportingEvidence: string;
}
/** Supplied only by a trusted server adapter after checking current account authority. */
export interface ControlEvidence {
	readonly subjectId: string;
	readonly network: Network;
	readonly address: string;
	readonly method: 'stellar-account-authority';
	readonly verifiedAt: string;
	readonly reference: string;
}
export interface Application extends Submission {
	readonly id: string;
	readonly applicantId: string;
	readonly control: ControlEvidence;
	readonly state: VerificationState;
	readonly revision: number;
	readonly submittedAt: string;
	readonly updatedAt: string;
	readonly review: null | {
		readonly reviewerId: string;
		readonly reason: string;
		readonly identityEvidenceReviewed: boolean;
		readonly at: string;
	};
}
export interface Decision {
	readonly revision: number;
	readonly state: Exclude<VerificationState, 'pending'>;
	readonly reason: string;
	readonly identityEvidenceReviewed: boolean;
}
export class VerificationError extends Error {
	constructor(
		readonly status: 400 | 401 | 403 | 404 | 409 | 503,
		message: string
	) {
		super(message);
	}
}
export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new VerificationError(400, 'Supply an object');
	return value as Record<string, unknown>;
}
export function text(value: unknown, limit: number): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > limit ||
		/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
	)
		throw new VerificationError(400, 'Invalid text field');
	return value.trim();
}
export function target(
	network: unknown,
	address: unknown
): { network: Network; address: string } {
	if (network !== 'mainnet' && network !== 'testnet')
		throw new VerificationError(400, 'Choose mainnet or testnet');
	const account = text(address, 56);
	try {
		if (parseDirectoryAddress(account).addressKind !== 'account')
			throw new Error();
	} catch {
		throw new VerificationError(400, 'Supply a valid Stellar account address');
	}
	return { network, address: account };
}
export function parseSubmission(value: unknown): Submission {
	const input = record(value);
	if (
		Object.keys(input).some(
			(key) =>
				![
					'network',
					'address',
					'name',
					'website',
					'supportingEvidence'
				].includes(key)
		)
	)
		throw new VerificationError(400, 'Unexpected application field');
	const website = text(input.website, 512);
	let url: URL;
	try {
		url = new URL(website);
	} catch {
		throw new VerificationError(400, 'Supply an HTTPS website');
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.hash)
		throw new VerificationError(
			400,
			'Supply an HTTPS website without credentials or fragment'
		);
	return {
		...target(input.network, input.address),
		name: text(input.name, 120),
		website: url.href,
		supportingEvidence: text(input.supportingEvidence, 4000)
	};
}
export function parseDecision(value: unknown): Decision {
	const input = record(value);
	if (
		Object.keys(input).some(
			(key) =>
				!['revision', 'state', 'reason', 'identityEvidenceReviewed'].includes(
					key
				)
		) ||
		!Number.isSafeInteger(input.revision) ||
		Number(input.revision) < 1 ||
		!['changes_requested', 'approved', 'rejected', 'revoked'].includes(
			String(input.state)
		) ||
		typeof input.identityEvidenceReviewed !== 'boolean'
	)
		throw new VerificationError(400, 'Invalid review decision');
	return {
		revision: Number(input.revision),
		state: input.state as Decision['state'],
		reason: text(input.reason, 1000),
		identityEvidenceReviewed: input.identityEvidenceReviewed
	};
}
export function assertControl(
	evidence: ControlEvidence | null,
	applicantId: string,
	input: Pick<Submission, 'network' | 'address'>,
	now: Date
): asserts evidence is ControlEvidence {
	const age = evidence ? now.getTime() - Date.parse(evidence.verifiedAt) : NaN;
	if (
		!evidence ||
		evidence.subjectId !== applicantId ||
		evidence.network !== input.network ||
		evidence.address !== input.address ||
		evidence.method !== 'stellar-account-authority' ||
		!Number.isFinite(age) ||
		age < 0 ||
		age > 5 * 60_000 ||
		!evidence.reference ||
		evidence.reference.length > 200
	)
		throw new VerificationError(
			403,
			'Fresh account-control evidence is required'
		);
}
/** An allowlist projection: private evidence and reviewer identities never enter public responses. */
export function publicVerification(application: Application | null) {
	if (
		application?.state !== 'approved' ||
		!application.review?.identityEvidenceReviewed
	)
		return null;
	return {
		source: 'stellaratlas/verification' as const,
		publisher: 'StellarAtlas' as const,
		status: 'verified' as const,
		address: application.address,
		network: application.network,
		name: application.name,
		website: application.website,
		revision: application.revision,
		verifiedAt: application.review.at
	};
}
