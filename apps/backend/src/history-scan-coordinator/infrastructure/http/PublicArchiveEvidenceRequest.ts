import type express from 'express';
import { isIP } from 'node:net';

export type ArchiveEvidenceErrorCode =
	'internal_error' | 'invalid_request' | 'not_found' | 'rate_limited';

interface RateWindow {
	count: number;
	startedAt: number;
}

export interface PublicArchiveEvidencePeer {
	readonly cfConnectingIp?: string | readonly string[];
	readonly forwardedFor?: string | readonly string[];
	readonly remoteAddress?: string;
}

export class PublicArchiveEvidenceAdmission {
	private activeRequests = 0;
	private readonly windows = new Map<string, RateWindow>();

	constructor(
		private readonly maxConcurrentRequests = 4,
		private readonly maxRequestsPerWindow = 120,
		private readonly windowMs = 60_000,
		private readonly now: () => number = Date.now,
		private readonly maxTrackedIdentities = 10_000
	) {}

	middleware(): express.RequestHandler {
		return (req, res, next) => {
			if (this.activeRequests >= this.maxConcurrentRequests) {
				res.setHeader('Retry-After', '1');
				sendArchiveEvidenceError(
					res,
					429,
					'rate_limited',
					'Archive evidence service is busy'
				);
				return;
			}
			const identity = resolvePublicArchiveEvidenceIdentity({
				cfConnectingIp: req.headers['cf-connecting-ip'],
				forwardedFor: req.headers['x-forwarded-for'],
				remoteAddress: req.socket.remoteAddress
			});
			if (identity !== null && !this.acceptRate(identity)) {
				res.setHeader('Retry-After', '60');
				sendArchiveEvidenceError(
					res,
					429,
					'rate_limited',
					'Archive evidence request rate exceeded'
				);
				return;
			}
			this.activeRequests++;
			let released = false;
			const release = (): void => {
				if (released) return;
				released = true;
				this.activeRequests--;
			};
			res.once('finish', release);
			res.once('close', release);
			next();
		};
	}

	getActiveRequestCount(): number {
		return this.activeRequests;
	}

	getTrackedIdentityCount(): number {
		return this.windows.size;
	}

	private acceptRate(identity: string): boolean {
		const now = this.now();
		const current = this.windows.get(identity);
		if (current === undefined || now - current.startedAt >= this.windowMs) {
			this.windows.set(identity, { count: 1, startedAt: now });
			this.boundWindows(now);
			return true;
		}
		current.count++;
		return current.count <= this.maxRequestsPerWindow;
	}

	private boundWindows(now: number): void {
		if (this.windows.size <= this.maxTrackedIdentities) return;
		for (const [identity, window] of this.windows) {
			if (now - window.startedAt >= this.windowMs)
				this.windows.delete(identity);
		}
		while (this.windows.size > this.maxTrackedIdentities) {
			const oldest = this.windows.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.windows.delete(oldest);
		}
	}
}

export function resolvePublicArchiveEvidenceIdentity(
	peer: PublicArchiveEvidencePeer
): string | null {
	const remoteAddress = normalizeIp(peer.remoteAddress);
	if (remoteAddress === null) return null;
	if (!isLoopback(remoteAddress)) return `socket:${remoteAddress}`;

	const ingressAddress = readSingleIp(peer.cfConnectingIp);
	return ingressAddress === null ? null : `ingress:${ingressAddress}`;
}

function readSingleIp(
	value: string | readonly string[] | undefined
): string | null {
	if (typeof value !== 'string' || value.trim() !== value) return null;
	return normalizeIp(value);
}

function normalizeIp(value: string | undefined): string | null {
	if (value === undefined || value.length === 0 || value.length > 64)
		return null;
	const mappedPrefix = '::ffff:';
	if (value.toLowerCase().startsWith(mappedPrefix)) {
		const ipv4 = value.slice(mappedPrefix.length);
		return isIP(ipv4) === 4 ? ipv4 : null;
	}
	const version = isIP(value);
	if (version === 4) return value;
	if (version !== 6) return null;
	try {
		const hostname = new URL(`http://[${value}]/`).hostname;
		return hostname.slice(1, -1).toLowerCase();
	} catch {
		return null;
	}
}

function isLoopback(address: string): boolean {
	if (address === '::1') return true;
	if (isIP(address) !== 4) return false;
	const firstOctet = Number(address.split('.')[0]);
	return firstOctet === 127;
}

export const publicArchiveEvidenceAdmission =
	new PublicArchiveEvidenceAdmission();

export function setArchiveEvidenceCacheHeaders(res: express.Response): void {
	res.setHeader(
		'Cache-Control',
		'public, max-age=10, stale-while-revalidate=20'
	);
}

export function sendArchiveEvidenceError(
	res: express.Response,
	status: number,
	code: ArchiveEvidenceErrorCode,
	message: string
): express.Response {
	return res.status(status).json({ error: { code, message } });
}
