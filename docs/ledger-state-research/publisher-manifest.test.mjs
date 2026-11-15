import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, createSecretKey, sign, verify } from 'node:crypto';
import { test } from 'node:test';
import { acceptPublication, canonicalManifestBytes, MANIFEST_DOMAIN } from './publisher-manifest.mjs';

// PUBLIC RFC 8032 section 7.1 test seeds. Never use these keys for any real identity.
const seedA = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const seedB = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
function testKey(seed) {
	return createPrivateKey({ key: Buffer.from('302e020100300506032b657004220420' + seed, 'hex'), format: 'der', type: 'pkcs8' });
}
const privateA = testKey(seedA), privateB = testKey(seedB);
const publicA = createPublicKey(privateA), publicB = createPublicKey(privateB);
const now = 1800000000; // Fixed logical test clock; not a ledger-close timestamp.
const hex = value => value.toString(16).padStart(2, '0').repeat(32);
const expected = {
	ledgerSequence: 63, headerHash: hex(2), nativeRootHash: hex(3), keyHash: hex(4),
	valueHash: hex(5), relation: 'synthetic-pinned-claim/v1', evidenceHash: hex(6)
};
const manifest = {
	version: 1, publisher: 'example-publisher', keyId: 'test-v1', networkId: hex(1),
	...expected, issuedAt: now - 10, expiresAt: now + 50, nonce: '07'.repeat(16)
};
const key = (keyId, publicKey) => ({ keyId, publicKey, validFrom: now - 1000, validUntil: now + 1000 });
const policy = {
	publisher: manifest.publisher, networkId: manifest.networkId, keys: [key('test-v1', publicA)],
	maxAgeSeconds: 120, maxLifetimeSeconds: 300, clockSkewSeconds: 0, maxReplayEntries: 2
};
const context = (changes = {}) => ({ policy, expected, now, replays: new Map(), ...changes });
function signed(value = manifest, privateKey = privateA) {
	return { manifest: value, signatureHex: sign(null, canonicalManifestBytes(value), privateKey).toString('hex') };
}
const fails = (code, operation) => assert.throws(operation, error => error.code === code);

test('Node Ed25519 matches the public RFC 8032 empty-message signature vector', () => {
	const signature = sign(null, Buffer.alloc(0), privateA);
	assert.equal(publicA.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
		'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
	assert.equal(signature.toString('hex'), 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
		'5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
	assert.equal(verify(null, Buffer.alloc(0), publicA, signature), true);
});

test('canonical bytes use fixed fields/domain, independent of object insertion order', () => {
	const expectedArray = [1, 'example-publisher', 'test-v1', hex(1), 63, hex(2), hex(3), hex(4), hex(5),
		'synthetic-pinned-claim/v1', hex(6), now - 10, now + 50, '07'.repeat(16)];
	const golden = Buffer.from('AtlasPublisherManifest/v1\0' + JSON.stringify(expectedArray));
	assert.deepEqual(canonicalManifestBytes(manifest), golden);
	assert.deepEqual(canonicalManifestBytes(Object.fromEntries(Object.entries(manifest).reverse())), golden);
	assert.equal(golden.length < 2048, true);
});

test('the claim tuple matches the already retained synthetic kernel, without rerunning it', () => {
	const ledger = Buffer.alloc(4); ledger.writeUInt32BE(expected.ledgerSequence);
	const tuple = Buffer.concat([Buffer.from('AtlasAttestedStateClaim/v1\0'), Buffer.from(manifest.networkId, 'hex'), ledger,
		...['headerHash', 'nativeRootHash', 'keyHash', 'valueHash'].map(name => Buffer.from(expected[name], 'hex'))]);
	assert.equal(tuple.length, 191);
	assert.equal(createHash('sha256').update(tuple).digest('hex'), '83575b323dd4244713e5934e1f13ccb0adc9559281f35fb77915c41bd174b6d3');
});

test('a valid externally authorized publication is attributed and consumes one replay slot', () => {
	const ctx = context(), result = acceptPublication(signed(), ctx);
	assert.equal(result.publisher, policy.publisher);
	assert.equal(result.keyId, 'test-v1');
	assert.equal(result.manifestHash, createHash('sha256').update(canonicalManifestBytes(manifest)).digest('hex'));
	assert.equal(ctx.replays.size, 1);
	assert.equal(Object.isFrozen(result), true);
});

for (const field of Object.keys(manifest)) {
	test(`an unsigned mutation of ${field} cannot reuse a valid signature`, () => {
		const value = manifest[field];
		const changed = typeof value === 'number' ? value + 1 : field === 'nonce' ? '08'.repeat(16) :
			/^[0-9a-f]{64}$/.test(value) ? hex(9) : value + '-changed';
		const envelope = { ...signed(), manifest: { ...manifest, [field]: changed } };
		assert.throws(() => acceptPublication(envelope, context()));
	});
}

for (const [label, value, code] of [
	['publisher', { publisher: 'other-publisher' }, 'publisher'],
	['network', { networkId: hex(9) }, 'network'],
	['ledger', { ledgerSequence: 64 }, 'claim'],
	['checkpoint/header', { headerHash: hex(9) }, 'claim'],
	['native root', { nativeRootHash: hex(9) }, 'claim'],
	['key commitment', { keyHash: hex(9) }, 'claim'],
	['value commitment', { valueHash: hex(9) }, 'claim'],
	['relation/version', { relation: 'synthetic-pinned-claim/v2' }, 'claim'],
	['supporting evidence', { evidenceHash: hex(9) }, 'claim']
]) {
	test(`even a valid signer cannot substitute the externally expected ${label}`, () => {
		fails(code, () => acceptPublication(signed({ ...manifest, ...value }), context()));
	});
}

test('a different signer cannot impersonate the configured key ID', () => {
	fails('signature', () => acceptPublication(signed(manifest, privateB), context()));
});
test('a witness-provided public key or policy is never accepted', () => {
	for (const extra of [{ publicKey: publicB }, { policy }, { nextKey: publicB }])
		fails('schema', () => acceptPublication({ ...signed(), ...extra }, context()));
});
test('unknown/self-announced rotation is rejected; only an external policy update authorizes it', () => {
	const rotated = signed({ ...manifest, keyId: 'test-v2' }, privateB);
	fails('key', () => acceptPublication(rotated, context()));
	const updated = { ...policy, keys: [key('test-v2', publicB)] };
	assert.equal(acceptPublication(rotated, context({ policy: updated })).keyId, 'test-v2');
	fails('key', () => acceptPublication(signed(), context({ policy: updated })));
});
test('duplicate key IDs and private/symmetric verification keys are rejected as policy errors', () => {
	for (const keys of [[key('test-v1', publicA), key('test-v1', publicB)], [key('test-v1', privateA)], [key('test-v1', createSecretKey(Buffer.alloc(32)))]])
		fails('policy', () => acceptPublication(signed(), context({ policy: { ...policy, keys } })));
});
test('a signature over another application domain cannot authorize this payload', () => {
	const bytes = canonicalManifestBytes(manifest);
	const wrongDomain = Buffer.concat([Buffer.from('OtherPublisherManifest/v1\0'), bytes.subarray(Buffer.byteLength(MANIFEST_DOMAIN))]);
	const signatureHex = sign(null, wrongDomain, privateA).toString('hex');
	fails('signature', () => acceptPublication({ manifest, signatureHex }, context()));
});

for (const [label, changes, policyChanges, code] of [
	['future issue time', { issuedAt: now + 1 }, {}, 'future'],
	['expired at the exact boundary', { issuedAt: now - 60, expiresAt: now }, {}, 'expired'],
	['stale but not expired', { issuedAt: now - 121 }, {}, 'stale'],
	['overlong validity', { issuedAt: now - 10, expiresAt: now + 291 }, {}, 'lifetime'],
	['key not yet eligible', {}, { keys: [{ ...key('test-v1', publicA), validFrom: now }] }, 'key-window'],
	['publication beyond key lifetime', {}, { keys: [{ ...key('test-v1', publicA), validUntil: now + 49 }] }, 'key-window']
]) {
	test(`freshness policy rejects ${label}`, () => {
		fails(code, () => acceptPublication(signed({ ...manifest, ...changes }), context({ policy: { ...policy, ...policyChanges } })));
	});
}
test('clock-skew allowance is explicit and stops at the exact expiry-plus-skew boundary', () => {
	const skewed = { ...policy, clockSkewSeconds: 5 };
	assert.equal(acceptPublication(signed({ ...manifest, issuedAt: now + 5 }), context({ policy: skewed })).publisher, manifest.publisher);
	fails('future', () => acceptPublication(signed({ ...manifest, issuedAt: now + 6 }), context({ policy: skewed })));
	const envelope = signed({ ...manifest, issuedAt: now - 60, expiresAt: now - 5 });
	fails('expired', () => acceptPublication(envelope, context({ policy: skewed })));
});

test('replay rejects the same nonce across signatures, changed claims and externally rotated keys', () => {
	const ctx = context(); acceptPublication(signed(), ctx);
	fails('replay', () => acceptPublication(signed(), ctx));
	const changed = { ...manifest, issuedAt: now - 9 };
	fails('replay', () => acceptPublication(signed(changed), ctx));
	const rotationPolicy = { ...policy, keys: [key('test-v2', publicB)] };
	fails('replay', () => acceptPublication(signed({ ...manifest, keyId: 'test-v2' }, privateB), { ...ctx, policy: rotationPolicy }));
});
test('a full bounded replay window fails closed without evicting live entries', () => {
	const ctx = context(); acceptPublication(signed(), ctx);
	acceptPublication(signed({ ...manifest, nonce: '08'.repeat(16) }), ctx);
	const before = [...ctx.replays];
	fails('capacity', () => acceptPublication(signed({ ...manifest, nonce: '09'.repeat(16) }), ctx));
	assert.deepEqual([...ctx.replays], before);
});
test('only expired replay entries are pruned after a fully valid attempt', () => {
	const ctx = context(); acceptPublication(signed(), ctx);
	const later = { ...manifest, issuedAt: now + 50, expiresAt: now + 100, nonce: '08'.repeat(16) };
	acceptPublication(signed(later), { ...ctx, now: now + 50 });
	assert.equal(ctx.replays.size, 1);
	fails('expired', () => acceptPublication(signed(), { ...ctx, now: now + 50 }));
});
test('invalid signatures or expected claims do not consume or prune replay state', () => {
	for (const bad of [signed(manifest, privateB), signed({ ...manifest, headerHash: hex(9) })]) {
		const ctx = context({ replays: new Map([[hex(9), now - 1]]) });
		assert.throws(() => acceptPublication(bad, ctx));
		assert.deepEqual([...ctx.replays], [[hex(9), now - 1]]);
	}
});

for (const [label, changes] of [
	['unknown version', { version: 2 }], ['unknown field', { extra: true }],
	['uppercase digest', { headerHash: 'AB'.repeat(32) }], ['short digest', { headerHash: '00' }],
	['noninteger ledger', { ledgerSequence: 63.5 }], ['oversized ledger', { ledgerSequence: 0x100000000 }],
	['string time', { issuedAt: String(now) }], ['reversed expiry', { expiresAt: manifest.issuedAt }],
	['noncanonical identifier', { publisher: 'example publisher' }], ['oversized identifier', { publisher: 'x'.repeat(65) }],
	['short nonce', { nonce: '00' }]
]) {
	test(`canonical schema rejects ${label}`, () => {
		fails('schema', () => canonicalManifestBytes({ ...manifest, ...changes }));
	});
}
test('missing fields, accessors and symbol fields are outside the canonical object schema', () => {
	const missing = { ...manifest }; delete missing.relation;
	const getter = { ...manifest }; Object.defineProperty(getter, 'publisher', { get: () => manifest.publisher, enumerable: true });
	for (const value of [missing, getter, { ...manifest, [Symbol('extra')]: true }])
		fails('schema', () => canonicalManifestBytes(value));
});
test('acceptance uses the descriptor snapshot that was signed, not later property reads', () => {
	const envelope = signed();
	const proxy = new Proxy(manifest, { get: () => { throw new Error('Property getter must not be called'); } });
	assert.equal(acceptPublication({ ...envelope, manifest: proxy }, context()).publisher, manifest.publisher);
});
test('signatures require exactly 64 bytes of lowercase hex, without coercion', () => {
	for (const signatureHex of ['', '00'.repeat(63), '00'.repeat(65), 'GG'.repeat(64), Buffer.alloc(64)])
		fails('schema', () => acceptPublication({ manifest, signatureHex }, context()));
});
test('policy bounds and replay-state corruption fail closed', () => {
	for (const patch of [{ maxReplayEntries: 129 }, { clockSkewSeconds: 61 }, { maxAgeSeconds: 0 }, { keys: [] }])
		fails('policy', () => acceptPublication(signed(), context({ policy: { ...policy, ...patch } })));
	fails('replay-state', () => acceptPublication(signed(), context({ replays: new Map([[hex(9), NaN]]) })));
	fails('replay-state', () => acceptPublication(signed(), context({ replays: new Map([[hex(7), now], [hex(8), now], [hex(9), now]]) })));
});
