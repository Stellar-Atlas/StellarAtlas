import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type ArchiveEvidenceCursorKind =
	'events' | 'objects' | 'remote-failures' | 'worker-issues';

export interface ArchiveEvidenceCursorPosition {
	readonly at: Date;
	readonly remoteId: string;
}

export type DecodedArchiveEvidenceCursor = ArchiveEvidenceCursorPosition;

interface CursorKey {
	readonly id: string;
	readonly secret: Buffer;
}

interface CursorPayloadV1 {
	readonly a: number;
	readonly f: string;
	readonly k: 'e' | 'o' | 'r' | 'w';
	readonly r: string;
	readonly s: number;
	readonly t: number;
	readonly v: 1;
}

interface CursorPayloadV2 {
	readonly a: number;
	readonly f: string;
	readonly k: 'e' | 'o' | 'r' | 'w';
	readonly r: string;
	readonly v: 2;
}

const developmentSecret = Buffer.from('stellaratlas-development-cursor-key-v1');
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ArchiveEvidenceCursorCodec {
	constructor(private readonly keys: readonly CursorKey[]) {
		if (keys.length === 0)
			throw new Error('Archive evidence cursor keys are empty');
	}

	encode(input: {
		readonly filters: object;
		readonly kind: ArchiveEvidenceCursorKind;
		readonly position: ArchiveEvidenceCursorPosition;
		readonly rootScope: readonly string[];
	}): string {
		const signingKey = this.keys[0];
		if (signingKey === undefined)
			throw new Error('Cursor signing key is missing');
		const payload: CursorPayloadV2 = {
			a: requireEpoch(input.position.at),
			f: fingerprint(input.kind, input.filters, input.rootScope),
			k: encodeKind(input.kind),
			r: encodeUuid(input.position.remoteId),
			v: 2
		};
		const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
			'base64url'
		);
		const signature = sign(signingKey.secret, signingKey.id, encodedPayload);
		return `${signingKey.id}.${encodedPayload}.${signature}`;
	}

	decode(input: {
		readonly filters: object;
		readonly kind: ArchiveEvidenceCursorKind;
		readonly rootScope: readonly string[];
		readonly token: string;
	}): DecodedArchiveEvidenceCursor | null {
		if (input.token.length === 0 || input.token.length > 512) return null;
		const [keyId, encodedPayload, encodedSignature, extra] =
			input.token.split('.');
		if (
			keyId === undefined ||
			encodedPayload === undefined ||
			encodedSignature === undefined ||
			extra !== undefined
		) {
			return null;
		}
		const key = this.keys.find((candidate) => candidate.id === keyId);
		if (key === undefined) return null;
		const expectedSignature = sign(key.secret, keyId, encodedPayload);
		if (!equalBase64Url(encodedSignature, expectedSignature)) return null;

		try {
			const payload = JSON.parse(
				Buffer.from(encodedPayload, 'base64url').toString('utf8')
			) as unknown;
			if (!isCursorPayload(payload)) return null;
			if (payload.k !== encodeKind(input.kind)) return null;
			if (
				payload.f !== fingerprint(input.kind, input.filters, input.rootScope)
			) {
				return null;
			}
			const at = new Date(payload.a);
			if (payload.v === 1 && at > new Date(payload.s)) return null;
			return {
				at,
				remoteId: decodeUuid(payload.r)
			};
		} catch {
			return null;
		}
	}
}

export function createArchiveEvidenceCursorCodec(input: {
	readonly encodedKeys?: string;
	readonly nodeEnv: string;
}): ArchiveEvidenceCursorCodec {
	if (input.encodedKeys === undefined || input.encodedKeys.trim() === '') {
		if (input.nodeEnv === 'production') {
			throw new Error('ARCHIVE_EVIDENCE_CURSOR_KEYS is required in production');
		}
		return new ArchiveEvidenceCursorCodec([
			{ id: 'development-v1', secret: developmentSecret }
		]);
	}

	return new ArchiveEvidenceCursorCodec(parseKeys(input.encodedKeys));
}

function parseKeys(encodedKeys: string): readonly CursorKey[] {
	const seen = new Set<string>();
	return encodedKeys.split(',').map((entry) => {
		const separator = entry.indexOf(':');
		const id = separator < 0 ? '' : entry.slice(0, separator).trim();
		const encodedSecret =
			separator < 0 ? '' : entry.slice(separator + 1).trim();
		if (!/^[A-Za-z0-9_-]{1,24}$/.test(id) || seen.has(id)) {
			throw new Error(
				'Archive evidence cursor key id is invalid or duplicated'
			);
		}
		seen.add(id);
		const secret = Buffer.from(encodedSecret, 'base64url');
		if (
			secret.length !== 32 ||
			secret.toString('base64url') !== encodedSecret
		) {
			throw new Error(
				'Archive evidence cursor secret must be base64url and 32 bytes'
			);
		}
		return { id, secret };
	});
}

function fingerprint(
	kind: ArchiveEvidenceCursorKind,
	filters: object,
	rootScope: readonly string[]
): string {
	return createHash('sha256')
		.update(
			stableJson({
				filters,
				kind,
				rootScope: [...new Set(rootScope)].toSorted()
			})
		)
		.digest('base64url');
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (typeof value !== 'object' || value === null) return JSON.stringify(value);
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.toSorted()
		.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
		.join(',')}}`;
}

function sign(secret: Buffer, keyId: string, payload: string): string {
	return createHmac('sha256', secret)
		.update(`${keyId}.${payload}`)
		.digest('base64url');
}

function equalBase64Url(actual: string, expected: string): boolean {
	const actualBytes = Buffer.from(actual, 'base64url');
	const expectedBytes = Buffer.from(expected, 'base64url');
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

function encodeKind(kind: ArchiveEvidenceCursorKind): CursorPayloadV2['k'] {
	if (kind === 'events') return 'e';
	if (kind === 'objects') return 'o';
	if (kind === 'remote-failures') return 'r';
	return 'w';
}

function encodeUuid(remoteId: string): string {
	if (!uuidPattern.test(remoteId))
		throw new Error('Cursor remote id is invalid');
	return Buffer.from(remoteId.replaceAll('-', ''), 'hex').toString('base64url');
}

function decodeUuid(encoded: string): string {
	const hex = Buffer.from(encoded, 'base64url').toString('hex');
	if (hex.length !== 32) throw new Error('Cursor remote id is invalid');
	const remoteId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
		12,
		16
	)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	if (!uuidPattern.test(remoteId))
		throw new Error('Cursor remote id is invalid');
	return remoteId;
}

function requireEpoch(value: Date): number {
	const epoch = value.getTime();
	if (!Number.isSafeInteger(epoch) || epoch < 0) {
		throw new Error('Cursor date is invalid');
	}
	return epoch;
}

function isCursorPayload(
	value: unknown
): value is CursorPayloadV1 | CursorPayloadV2 {
	if (typeof value !== 'object' || value === null) return false;
	const payload = value as Record<string, unknown>;
	const common =
		typeof payload.a === 'number' &&
		Number.isSafeInteger(payload.a) &&
		payload.a >= 0 &&
		typeof payload.f === 'string' &&
		/^[A-Za-z0-9_-]{43}$/.test(payload.f) &&
		(payload.k === 'e' ||
			payload.k === 'o' ||
			payload.k === 'r' ||
			payload.k === 'w') &&
		typeof payload.r === 'string';
	if (!common) return false;
	if (payload.v === 2) return true;
	return (
		payload.v === 1 &&
		typeof payload.s === 'number' &&
		Number.isSafeInteger(payload.s) &&
		payload.s >= 0 &&
		typeof payload.t === 'number' &&
		Number.isSafeInteger(payload.t) &&
		payload.t >= 0
	);
}
