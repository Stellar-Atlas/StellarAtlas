export interface VerificationDraft {
	network: 'mainnet' | 'testnet';
	address: string;
	name: string;
	website: string;
	supportingEvidence: string;
}
export type VerificationState =
	'pending' | 'changes_requested' | 'approved' | 'rejected' | 'revoked';
export type SavedApplication = VerificationDraft & {
	id: string;
	state: VerificationState;
	revision: number;
	reason: string | null;
};
export function readApplication(value: unknown): SavedApplication | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (
		typeof row.id !== 'string' ||
		!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.id) ||
		![
			'pending',
			'changes_requested',
			'approved',
			'rejected',
			'revoked'
		].includes(String(row.state)) ||
		!Number.isSafeInteger(row.revision) ||
		Number(row.revision) < 1 ||
		(row.network !== 'mainnet' && row.network !== 'testnet') ||
		typeof row.address !== 'string' ||
		!/^G[A-Z2-7]{55}$/.test(row.address) ||
		typeof row.name !== 'string' ||
		row.name.length > 120 ||
		typeof row.website !== 'string' ||
		row.website.length > 512 ||
		typeof row.supportingEvidence !== 'string' ||
		row.supportingEvidence.length > 4000
	)
		return null;
	const review =
		row.review && typeof row.review === 'object'
			? (row.review as Record<string, unknown>)
			: null;
	return {
		id: row.id,
		state: row.state as VerificationState,
		revision: Number(row.revision),
		network: row.network,
		address: row.address,
		name: row.name,
		website: row.website,
		supportingEvidence: row.supportingEvidence,
		reason:
			typeof review?.reason === 'string' ? review.reason.slice(0, 1000) : null
	};
}
