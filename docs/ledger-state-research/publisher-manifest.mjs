// Offline research only. No network parser, durable replay store or production policy.
import { createHash, KeyObject, verify } from 'node:crypto';

export const MANIFEST_DOMAIN = 'AtlasPublisherManifest/v1\0';
const fields = [
	'version', 'publisher', 'keyId', 'networkId', 'ledgerSequence',
	'headerHash', 'nativeRootHash', 'keyHash', 'valueHash', 'relation',
	'evidenceHash', 'issuedAt', 'expiresAt', 'nonce'
];
const claimFields = [
	'ledgerSequence', 'headerHash', 'nativeRootHash', 'keyHash',
	'valueHash', 'relation', 'evidenceHash'
];
const hashFields = ['networkId', 'headerHash', 'nativeRootHash', 'keyHash', 'valueHash', 'evidenceHash'];
const maximumTime = 0xffffffff;

function reject(code) {
	throw Object.assign(new Error(code), { code });
}

function record(value, names, code = 'schema') {
	if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
		Reflect.ownKeys(value).length !== names.length) reject(code);
	const snapshot = {};
	for (const name of names) {
		const property = Object.getOwnPropertyDescriptor(value, name);
		if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) reject(code);
		snapshot[name] = property.value;
	}
	return snapshot;
}

function integer(value, minimum, maximum, code = 'schema') {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
}

function identifier(value) {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/.test(value)) reject('schema');
}

function hash(value) {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) reject('schema');
}

/** Fixed field order, ASCII-only values and integer times; not generic JSON canonicalization. */
export function canonicalManifestBytes(manifest) {
	manifest = record(manifest, fields);
	if (manifest.version !== 1) reject('schema');
	for (const name of ['publisher', 'keyId', 'relation']) identifier(manifest[name]);
	for (const name of hashFields) hash(manifest[name]);
	integer(manifest.ledgerSequence, 1, 0xffffffff);
	integer(manifest.issuedAt, 0, maximumTime);
	integer(manifest.expiresAt, 0, maximumTime);
	if (manifest.expiresAt <= manifest.issuedAt ||
		typeof manifest.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(manifest.nonce)) reject('schema');
	const bytes = Buffer.from(MANIFEST_DOMAIN + JSON.stringify(fields.map(name => manifest[name])), 'utf8');
	if (bytes.length > 2048) reject('schema');
	return bytes;
}

function checkPolicy(policy, expected, now, replays) {
	record(policy, ['publisher', 'networkId', 'keys', 'maxAgeSeconds', 'maxLifetimeSeconds', 'clockSkewSeconds', 'maxReplayEntries'], 'policy');
	identifier(policy.publisher);
	hash(policy.networkId);
	integer(policy.maxAgeSeconds, 1, 3600, 'policy');
	integer(policy.maxLifetimeSeconds, 1, 3600, 'policy');
	integer(policy.clockSkewSeconds, 0, 60, 'policy');
	integer(policy.maxReplayEntries, 1, 128, 'policy');
	integer(now, 0, maximumTime, 'policy');
	if (!Array.isArray(policy.keys) || policy.keys.length < 1 || policy.keys.length > 4) reject('policy');
	const ids = new Set();
	for (const key of policy.keys) {
		record(key, ['keyId', 'publicKey', 'validFrom', 'validUntil'], 'policy');
		identifier(key.keyId);
		if (ids.has(key.keyId) || !(key.publicKey instanceof KeyObject) ||
			key.publicKey.type !== 'public' || key.publicKey.asymmetricKeyType !== 'ed25519') reject('policy');
		ids.add(key.keyId);
		integer(key.validFrom, 0, maximumTime, 'policy');
		integer(key.validUntil, key.validFrom + 1, maximumTime, 'policy');
	}
	record(expected, claimFields, 'policy');
	integer(expected.ledgerSequence, 1, 0xffffffff, 'policy');
	identifier(expected.relation);
	for (const name of hashFields.filter(name => name !== 'networkId')) hash(expected[name]);
	if (!(replays instanceof Map) || replays.size > policy.maxReplayEntries) reject('replay-state');
	for (const [id, deadline] of replays) {
		hash(id);
		integer(deadline, 0, maximumTime + 60, 'replay-state');
	}
}

/**
 * Stateful acceptance under caller-owned TEST trust/clock/claim/replay policy.
 * A successful return attributes these bytes, not true ledger state or consensus.
 */
export function acceptPublication(envelope, { policy, expected, now, replays }) {
	envelope = record(envelope, ['manifest', 'signatureHex']);
	const manifest = record(envelope.manifest, fields);
	const bytes = canonicalManifestBytes(manifest);
	if (typeof envelope.signatureHex !== 'string' || !/^[0-9a-f]{128}$/.test(envelope.signatureHex)) reject('schema');
	checkPolicy(policy, expected, now, replays);
	if (manifest.publisher !== policy.publisher) reject('publisher');
	if (manifest.networkId !== policy.networkId) reject('network');
	const key = policy.keys.find(value => value.keyId === manifest.keyId);
	if (!key) reject('key');
	if (!verify(null, bytes, key.publicKey, Buffer.from(envelope.signatureHex, 'hex'))) reject('signature');
	for (const name of claimFields) if (manifest[name] !== expected[name]) reject('claim');
	if (manifest.expiresAt - manifest.issuedAt > policy.maxLifetimeSeconds) reject('lifetime');
	if (manifest.issuedAt < key.validFrom || manifest.expiresAt > key.validUntil) reject('key-window');
	const skew = policy.clockSkewSeconds;
	if (manifest.issuedAt > now + skew) reject('future');
	if (now >= manifest.expiresAt + skew) reject('expired');
	if (now > manifest.issuedAt + policy.maxAgeSeconds + skew) reject('stale');
	// One nonce per publisher/network, including across an externally authorized key change.
	const publicationId = createHash('sha256').update('AtlasPublisherReplay/v1\0')
		.update(JSON.stringify([manifest.publisher, manifest.networkId, manifest.nonce])).digest('hex');
	// Mutate replay state only after all cryptographic, claim and time checks pass.
	for (const [id, deadline] of replays) if (deadline <= now) replays.delete(id);
	if (replays.has(publicationId)) reject('replay');
	if (replays.size >= policy.maxReplayEntries) reject('capacity');
	replays.set(publicationId, manifest.expiresAt + skew);
	return Object.freeze({
		publisher: manifest.publisher, keyId: manifest.keyId, publicationId,
		manifestHash: createHash('sha256').update(bytes).digest('hex'),
		expiresAt: manifest.expiresAt
	});
}
