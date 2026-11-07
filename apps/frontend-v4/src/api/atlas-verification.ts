import { isClassicAccount } from '../domain/classic-account';
import type { VerificationSession } from '../components/verification/verification-authentication';
import { readApplication } from './verification-application';

export type VerificationNetwork = 'mainnet' | 'testnet';
export interface AtlasIdentity {
	readonly source: 'stellaratlas/verification';
	readonly name: string;
	readonly website: string;
	readonly verifiedAt: string;
	readonly revision: number;
}
export type ReviewApplication = NonNullable<
	ReturnType<typeof readApplication>
> & {
	readonly submittedAt: string;
	readonly controlVerifiedAt: string;
};
export class VerificationRequestError extends Error {
	constructor(readonly status: number) {
		super(
			status === 401
				? 'Your session expired. Sign in again.'
				: status === 403
					? 'Reviewer access or current account-control evidence is required.'
					: status === 409
						? 'This application changed. Load it again before deciding.'
						: status === 429
							? 'Verification is busy. Wait one minute before trying again.'
							: 'Atlas verification is currently unavailable.'
		);
	}
}
const record = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const text = (value: unknown, max: number): value is string =>
	typeof value === 'string' &&
	!!value.trim() &&
	value.length <= max &&
	!/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);
const date = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value;
export const verificationId = (value: string): boolean =>
	/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export function verificationWebsite(value: unknown): string | null {
	if (!text(value, 512)) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' &&
			!url.username &&
			!url.password &&
			!url.hash
			? url.href
			: null;
	} catch {
		return null;
	}
}
export function readAtlasIdentity(
	value: unknown,
	network: VerificationNetwork,
	address: string
): AtlasIdentity | null {
	const envelope = record(value);
	if (envelope.verification === null) return null;
	const row = record(envelope.verification),
		website = verificationWebsite(row.website);
	if (
		row.source !== 'stellaratlas/verification' ||
		row.publisher !== 'StellarAtlas' ||
		row.status !== 'verified' ||
		row.network !== network ||
		row.address !== address ||
		!isClassicAccount(address) ||
		!text(row.name, 120) ||
		!website ||
		!date(row.verifiedAt) ||
		!Number.isSafeInteger(row.revision) ||
		Number(row.revision) < 1
	)
		throw new VerificationRequestError(503);
	// Explicit public projection: no evidence, reviewer IDs or imported labels.
	return {
		source: 'stellaratlas/verification',
		name: row.name,
		website,
		verifiedAt: row.verifiedAt,
		revision: Number(row.revision)
	};
}
export function readReviewApplication(value: unknown): ReviewApplication {
	const saved = readApplication(value),
		row = record(value),
		control = record(row.control);
	if (
		!saved ||
		!isClassicAccount(saved.address) ||
		!text(saved.name, 120) ||
		!verificationWebsite(saved.website) ||
		!date(row.submittedAt) ||
		!date(control.verifiedAt) ||
		control.network !== saved.network ||
		control.address !== saved.address ||
		control.method !== 'stellar-account-authority'
	)
		throw new VerificationRequestError(503);
	return {
		...saved,
		submittedAt: row.submittedAt,
		controlVerifiedAt: control.verifiedAt
	};
}
export function readReviewQueue(value: unknown): {
	readonly items: readonly ReviewApplication[];
	readonly nextCursor: string | null;
} {
	const row = record(value);
	if (!Array.isArray(row.items) || row.items.length > 20)
		throw new VerificationRequestError(503);
	const items = row.items.map(readReviewApplication);
	if (
		items.some((item) => item.state !== 'pending') ||
		new Set(items.map((item) => item.id)).size !== items.length ||
		(row.nextCursor !== null &&
			(items.length !== 20 || row.nextCursor !== items.at(-1)?.id))
	)
		throw new VerificationRequestError(503);
	return {
		items,
		nextCursor: typeof row.nextCursor === 'string' ? row.nextCursor : null
	};
}
export function readVerificationCapabilities(value: unknown): {
	available: boolean;
	networks: readonly VerificationNetwork[];
} {
	const row = record(value);
	if (row.available === false) return { available: false, networks: [] };
	if (
		row.available !== true ||
		row.authentication !== 'stellar-challenge' ||
		!Array.isArray(row.networks) ||
		row.networks.length < 1 ||
		row.networks.length > 2 ||
		row.networks.some((item) => item !== 'mainnet' && item !== 'testnet')
	)
		throw new VerificationRequestError(503);
	return { available: true, networks: row.networks as VerificationNetwork[] };
}
/** Fixed same-origin API only, bounded response and lifetime; tokens stay in memory. */
export async function requestVerification(
	path: string,
	signal: AbortSignal,
	session?: VerificationSession,
	body?: object
): Promise<unknown> {
	if (
		!/^\/(?:capabilities|review(?:\?after=[0-9a-f-]{36})?|applications\/[0-9a-f-]{36}(?:\/decisions)?|(?:mainnet|testnet)\/G[A-Z2-7]{55})$/.test(
			path
		)
	)
		throw new VerificationRequestError(400);
	if (session && Date.parse(session.expiresAt) <= Date.now())
		throw new VerificationRequestError(401);
	const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
	const response = await fetch('/v1/account-verification' + path, {
		method: body ? 'POST' : 'GET',
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		signal: boundedSignal,
		headers: {
			accept: 'application/json',
			...(session && { Authorization: 'Bearer ' + session.token }),
			...(body && { 'Content-Type': 'application/json' })
		},
		...(body && { body: JSON.stringify(body) })
	});
	const limit = 256 * 1024,
		length = response.headers.get('content-length');
	if (
		!response.ok ||
		!response.body ||
		(length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new VerificationRequestError(response.ok ? 503 : response.status);
	}
	const reader = response.body.getReader(),
		decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0,
		json = '';
	try {
		for (;;) {
			boundedSignal.throwIfAborted();
			const chunk = await reader.read();
			boundedSignal.throwIfAborted();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > limit) throw new VerificationRequestError(503);
			json += decoder.decode(chunk.value, { stream: true });
		}
		return JSON.parse(json + decoder.decode()) as unknown;
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
