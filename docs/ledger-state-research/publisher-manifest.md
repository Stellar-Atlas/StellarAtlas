# Offline publisher-manifest authorization experiment

This is a small, test-only extension to the [retained research synthesis](README.md),
not a production signing service, state prover, network trust anchor or public API.
The earlier synthesis and native-host test are unchanged.

## Relation being tested

An externally configured Ed25519 public key authorizes a bounded publication
manifest for one externally expected claim. Successful verification attributes
the signed bytes to a key permitted by that **test policy**. It does not prove
that the publisher is honest, that the claimed state is true, that the header is
consensus-authenticated, or that a key belongs to the real StellarAtlas operator.
The publisher label is deliberately `example-publisher`.

The synthetic network, ledger 63 and four state-claim commitments match the
earlier 191-byte pinned-claim tuple. The experiment additionally binds an evidence
digest, relation identifier, publisher/key IDs, issue/expiry times and a nonce.
The evidence digest is an assertion about bytes, not evidence availability or a
verified derivation. No real checkpoint, account or current state is introduced.

## Exact signed encoding

[`canonicalManifestBytes`](publisher-manifest.mjs) encodes this exact array order
as compact UTF-8 JSON, prefixed with the ASCII bytes
`AtlasPublisherManifest/v1` followed by one NUL byte:

```text
[version, publisher, keyId, networkId, ledgerSequence,
 headerHash, nativeRootHash, keyHash, valueHash, relation, evidenceHash,
 issuedAt, expiresAt, nonce]
```

This is a deliberately restricted format, not a generic JSON canonicalization
standard. Field names are required exactly once in the in-memory manifest object;
unknown/symbol/accessor fields are refused. Object insertion order does not alter
the signed array. Identifiers are 1–64 ASCII characters from the documented code
pattern; hashes are exactly 32 lowercase-hex bytes; the nonce is 16 lowercase-hex
bytes. The ledger is an integer in 1..2^32-1. Times are integer Unix seconds in
0..2^32-1 and expiry must follow issue time. The encoded payload is capped at
2 KiB; the signature must be exactly 64 bytes of lowercase hex.

The envelope has only `manifest` and `signatureHex`. It cannot supply a public
key, algorithm, policy or self-authorized next key. This module does **not** parse
untrusted wire JSON: callers would need a separately bounded parser and duplicate-
key/transport policy before a real network interface could be considered.

Node's standard-library [`crypto.sign`/`crypto.verify`](https://nodejs.org/download/release/v22.20.0/docs/api/crypto.html#cryptoverifyalgorithm-data-key-signature)
use Ed25519 with a `null` algorithm and an explicitly checked Ed25519 `KeyObject`.
The application domain prefix is part of the signed message; this is ordinary
Ed25519, not the separate Ed25519ctx variant. No curve, hash-signature or DER
implementation is introduced here.

## External policy, clock and replay assumptions

The caller supplies the authorized publisher, network, up to four unique key IDs
with public keys and validity intervals, exact expected claim, clock, and replay
map. These inputs are **outside the witness/envelope**. The experiment does not
establish how a production operator would authenticate, distribute, revoke,
persist or audit them. A witness-selected expected claim and policy would make
the result self-authorized and useless.

A valid signature alone is insufficient: the expected ledger, header, native
root, key, value, relation and evidence digest must match. A publication's whole
validity interval must fit its key's allowed interval. External key removal
revokes that key immediately under the selected policy. Unknown/new key IDs and
self-announced rotation are refused; an explicit external policy update can
authorize a new key and reject the retired one. There is no automatic rotation
protocol or trust-on-first-use.

The policy bounds maximum age and lifetime (1–3600 seconds), clock skew
(0–60 seconds), and replay entries (1–128). The tests use a fixed logical clock,
not system or ledger-close time. The interval is valid until, but not including,
`expiresAt + clockSkewSeconds`; age and future-issue checks also use that explicit
skew allowance. This tests policy arithmetic, not clock integrity or freshness
relative to the actual Stellar network.

Replay identity is a separately domain-separated digest of publisher, network
and nonce, including across externally authorized key changes. State is added
only after signature, expected-claim and time validation. Expired entries are
pruned; live entries are never evicted to admit a new publication. A full window
fails closed. After an entry expires, its old signed publication is expired too.
An authorized signer can deliberately issue a **new nonce** for the same claim;
that is a new publication, not forbidden by this nonce-based replay policy.
Nonce reservation lasts only through the stored validity deadline; reuse with
newly signed fresh timestamps after that deadline is not prohibited either.

The supplied `Map` is bounded, process-local and synchronous. State loss,
restarts, multiple processes, concurrent distributed verifiers, trusted-clock
rollback and durable/reconciled replay protection are not implemented. Acceptance
requires the caller to keep the same state and an appropriate nondecreasing
trusted clock. This is not an operational anti-replay service or an availability
guarantee.

## Deterministic offline qualification

Run only the new small fixture from the repository root, with existing Node:

```sh
node --test --test-concurrency=1 docs/ledger-state-research/publisher-manifest.test.mjs
```

The test keys are the **public, unsafe RFC 8032 section 7.1 test vectors**, with
private seeds intentionally in test source. They are never production credentials
and must never authorize any real publication. The RFC's empty-message golden
signature is checked before testing the application relation. See the
[primary test vectors](https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1).

The tests cover canonical ordering/domain, every signed field, wrong signer and
publisher, network/checkpoint/relation substitutions even by a valid signer,
unknown/revoked/self-authorized key rotation, malformed inputs, lifetime/age/key
intervals, clock-skew boundaries, replay/capacity/expiry cleanup, and preservation
of replay state after invalid attempts. They use no network, file-backed key
store, production keys, dependencies, cloud or server. No old fixture, native
host or full application build is rerun by this command.

## What remains unproved

This establishes only a bounded publisher-attribution/authorization relation
under explicit test-only external policy. It does not establish authenticated
checkpoint/network/quorum provenance, true state or native-state inclusion,
BLS12-381 proof soundness or key/setup provenance, independent proof generation,
production key ownership, a deployed service, current-protocol Wasm verification
costs, transaction/storage/fees, private-payment privacy, or the complete
five-second generation/publication target. No performance or throughput number
is derived from the test runner's elapsed time. Publication and integration of
this source remain separate decisions.
