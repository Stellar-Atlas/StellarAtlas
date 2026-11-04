# Ledger-state proof research: results and trust boundaries

Status: bounded research results as of 2026-11-02, not an operational prover or a production verification API.

The research goal is independently generated ledger-state claims bound to authenticated Stellar checkpoints, attributable publication, practical verifier experiments and evaluation of a five-second generation target. The [published research scope](https://github.com/SCF-Public-Goods-Maintenance/scf-public-goods-maintenance.github.io/blob/e136962d7549f82a2cd8c66fd83a2d4238c05487/docs/projects/stellaratlas.md) describes ongoing investigation, not delivery of a completed BLS12-381 prover or watchtower system.

## What the experiments establish

| Experiment | Observed result | Boundary |
| --- | --- | --- |
| Historical native-state fixture | 18 tests passed; full protocol-19 live BucketList content binding and classic-account replacement/deletion resolution agree with a retained native Core oracle for the fixture. | Conditional on a separately configured synthetic anchor. No consensus authentication or valid-history reachability. |
| Historical header ancestry | 12 tests passed; canonical headers and predecessor links bind synthetic ledger 63 to a separately pinned ledger 127 endpoint. | Hash-chain integrity does not authenticate the endpoint or its network. |
| Public checkpoint observation | A protocol-29 header and 64 archive records match the public API response; seven mutation/policy checks reject bad inputs. | Both services are SDF-operated. This is HTTPS-observer corroboration, not independent operators or a cryptographic quorum proof. |
| Historical native-host kernel | One Rust test passed a positive case and eleven negative assertions for equality to a synthetic trusted commitment. | Protocol-21 default native-host model only. No publisher authorization, state inclusion, BLS verification or Wasm transaction. |

These experiments are separate. The protocol-29 observation was not passed through the restricted protocol-19 decoder or used as the synthetic host kernel's trust anchor. Combining successful outputs does not fill the missing authentication and proof-relation steps.

## Conditional native-state resolution

The state fixture pins Core [345cf4159baba852fe8ba897b50fe83e7dcf5f91](https://github.com/stellar/stellar-core/tree/345cf4159baba852fe8ba897b50fe83e7dcf5f91), reported as `v20.0.0-rc.2.1`, and XDR [9ac02641139e6717924fdad716f6e958d0168491](https://github.com/stellar/stellar-xdr/tree/9ac02641139e6717924fdad716f6e958d0168491). The retained binary has SHA256 `4ea62c5617e878a61ac0dc5cd18c22a0294a4b6746cf0446ededdb9c8a9b8c24`; that identity and reported version are tooling assumptions, not a reproducible binary-to-source attestation.

The fixture is deliberately protocol 19, with two nonempty record-framed buckets totaling 480 bytes and a 324-byte header at synthetic ledger 63. All 22 live-BucketList slots are explicit. It includes an account updated in a newer bucket, an unchanged older account and a newer deletion shadowing an older live entry. Exact integer decoding preserves sequence `9007199254740994` and balance `123456789012345678` without floating-point conversion.

For this historical format, each level hash commits to ordered current and snapshot bucket hashes; the full root commits to all 11 levels. The reference follows the pinned [BucketList implementation](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/bucket/BucketList.cpp), [bucket output](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/bucket/BucketOutputIterator.cpp) and [record-framing writer](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/util/XDRStream.h). Complete committed file bytes are checked before temporal resolution; finding an old value somewhere in a committed bucket is insufficient.

The reference rejects a shadowed old value, a live value hidden by a tombstone, absent-key inclusion and mutations of the pinned claim. It reports missing committed buckets or unsupported formats as **not evaluable**, rather than accepting an incomplete witness or confusing unavailable evidence with a false claim. Absence is not converted into a zero balance, and no succinct non-inclusion proof is claimed.

The generated anchor is a test expectation, not an independent source of trust. The fixture is not demonstrated reachable from genesis through valid transactions. Re-running the same generator reproduced its bytes, but is not a second independent implementation. Modern live/hot-archive composition and current protocol semantics remain outside this decoder.

## Header, checkpoint and network binding

The historical header experiment checks consecutive sequences, canonical header hashes, every predecessor link and an externally configured endpoint. Its restricted forms are protocol 19, basic StellarValue and extension zero. The 65-header combined input is 23,660 bytes; the reference rejects oversized input, missing/extra records and a self-consistent replacement chain against the original anchor.

The relevant primary references are Core's [header-chain verification](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/catchup/VerifyLedgerChainWork.cpp), [checkpoint-hash writer](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/historywork/WriteVerifiedCheckpointHashesWork.cpp) and [starting-hash helper](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/main/ApplicationUtils.cpp). Checking ancestry is conditional on the starting trust policy; names such as “verified checkpoint” do not supply that policy.

The pinned [LedgerHeader XDR](https://github.com/stellar/stellar-xdr/blob/9ac02641139e6717924fdad716f6e958d0168491/Stellar-ledger.x) has no network-ID field. Equality to a chosen network label cannot intrinsically associate the same header bytes with that network. The historical [SCP signature domains](https://github.com/stellar/stellar-core/blob/345cf4159baba852fe8ba897b50fe83e7dcf5f91/src/herder/HerderImpl.cpp) bind their own statements/values; a signature is not automatically a quorum decision over a full resulting header and state root. Those historical references are not a current-protocol consensus validator.

### One real checkpoint, with explicit observer assumptions

The retained public sample is checkpoint **65,271,167**, protocol **29**, closed at `2026-11-02T17:46:59Z` and observed through public responses at `2026-11-02T17:49:50.198Z`. Its 428-byte header has SHA256 `45e84941c92b424f159144d0137cfadd9ec5ef5a6bd5f5bfa3bff5ef42fe0e14`.

The [public API ledger resource](https://horizon.stellar.org/ledgers/65271167) and [checkpoint archive](https://history.stellar.org/prd/core-live/core_live_001/ledger/03/e3/f5/ledger-03e3f57f.xdr.gz) supplied the compared data. The archive contains 64 headers, ledgers 65,271,104–65,271,167, with matching record hashes, sequences and predecessor links. Its compressed SHA256 is `1f077002bf9158bc41439d5bf08e22e549b8ecdf9858dfcd1cf07b2def866ed3`. These service URLs are provenance references, not immutable attestations or instructions to treat a fresh response as the captured sample.

Offline interpretation used official Stellar SDK 17.2.1 and Node 26.12.1, including canonical reserialization. Network labels were compared with the fixed public-network passphrase and its SHA256 network ID. Seven checks reject changed advertised hash, wrong API/archive network labels, wrong sequence, truncation, an extra record and byte mutation. A value signature is present in the captured header but was **not verified**.

The pinned official [Horizon Helm configuration](https://github.com/stellar/helm-charts/blob/c0a4a6186eddb8d955cdfe2cecdb48c4bab80bb0/charts/horizon/templates/_core-config.tpl) identifies the selected archive as SDF-operated. API/archive agreement therefore depends on a common operator, service correctness and HTTPS transport trust. It is not two independent operators. Certificate-chain/DNS evidence and signed response attestations were not retained. The state commitment remains opaque in this sample: no protocol-29 state inclusion or replay was checked.

## Reproducibility identities and distribution limits

| Controlled artifact | SHA256 |
| --- | --- |
| Protocol-19 native BucketList root | `23517b0cc4ce4c5ffaba46d44b7f8db6d488c922714c0bb9dd1dfebd84789e42` |
| Synthetic ledger-63 header | `8f9e1e62a36443c66f4f72a740da97e7f6ac0cac04d8c9de81eb0214d09e7fc3` |
| Frozen seven-file native fixture archive | `fa3946deb61641ec6f386638df67a67fd70f0681a95e2168b493b2797346c67c` |
| Synthetic ledger-127 endpoint header | `7576d8875c87373d4403812562514b35e598a4d16577c82cbb850ac74c842e72` |
| Historical host test source, linked below | `7abcb01e556d78fd72d048bf3a3c9d0efadda512c249c9ae190658e45a9f422e` |

The historical state/header tests and their full native-oracle package are retained research evidence, **not distributed by this document**. The digests identify those experiments but do not make unavailable bytes independently reproducible. A public portable release of those fixtures, reference decoder, test inventory and oracle instructions remains a separate deliverable. This payload distributes only the small host kernel below. No private evidence archive or operational environment is required by that kernel.

### Reproduce the limited host kernel

The [Rust integration-test source](attested_claim.rs) is the exact tested target. It uses a 191-byte fixed-width tuple: 27 domain bytes (`AtlasAttestedStateClaim/v1` plus NUL), 32-byte synthetic network ID, big-endian u32 ledger and four 32-byte commitments for header, native root, key and value. Its expected SHA256 is `83575b323dd4244713e5934e1f13ccb0adc9559281f35fb77915c41bd174b6d3`.

Use Rust/Cargo **1.80.1** and the official [soroban-env-host 21.2.0 source archive](https://static.crates.io/crates/soroban-env-host/soroban-env-host-21.2.0.crate), whose archive SHA256 is `4e25aaffe0c62eb65e0e349f725b4b8b13ad0764d78a15aab5bbccb5c4797726`. The archive ships `Cargo.lock` with SHA256 `c388b1d5e72186707b287b6d90b42f0aeb723dd35412c8b2fe34f3315b3aa2b0`. Its source revision is [8809852dcf8489f99407a5ceac12625ee3d14693](https://github.com/stellar/rs-soroban-env/tree/8809852dcf8489f99407a5ceac12625ee3d14693).

Verify those hashes, extract into a disposable directory, and copy the linked source into the extracted crate's `tests/attested_claim.rs`. Provision only the exact locked dependencies into a separate Cargo home before disabling networking. Do not update dependencies, substitute a current host or silently resolve around an absent package. With the required compiler and native prerequisites available, run from that crate directory:

```sh
CARGO_HOME=/path/to/isolated-cargo-home CARGO_BUILD_JOBS=1 \
  cargo test --locked --offline --test attested_claim -- --nocapture --test-threads=1
```

The measured run additionally used a network-disabled namespace. Offline Cargo alone is not a general filesystem or build-script sandbox. An offline resolution failure means prerequisites are missing, not a failed proof or permission to upgrade versions. The test changes the domain, network, ledger, header, root, key and value independently, then rejects wrong/short anchors and truncated/extended messages: one positive plus eleven negatives in one Rust test.

The trusted digest is fixed outside the submitted claim in the experiment. An interface accepting an attacker-selected claim and attacker-selected “trusted” digest would be tautological. A real publication mechanism must separately authorize that digest and bind its network, checkpoint, relation version, publisher key policy and freshness/replay rules. This test implements none of those authorization steps.

## What the host numbers mean

The positive path consumed **17,621 modeled CPU cost units** and **495 modeled memory bytes**, under historical host **21.2.0**, **protocol 21**, with its reset local default native budget. The [budget implementation](https://github.com/stellar/rs-soroban-env/blob/8809852dcf8489f99407a5ceac12625ee3d14693/soroban-env-host/src/budget.rs) and [host operations](https://github.com/stellar/rs-soroban-env/blob/8809852dcf8489f99407a5ceac12625ee3d14693/soroban-env-host/src/host.rs) define the model. Counters cover byte-object creation, SHA256, anchor creation and metered content comparison, before the negative cases.

These are not hardware instruction counts or peak resident memory. They are not protocol-29 parameters, network resource fees, Wasm dispatch, ledger reads/writes, authorization or transaction simulation. A single debug-test elapsed sample was 62,075 ns, including assertion and counter-read overhead; it is not a calibrated latency or throughput benchmark. This was native Rust host execution, not an on-chain transaction.

There is no BLS12-381 relation, proving key, verification key or proof in this kernel. Hash equality, an Ed25519 publisher signature and BLS proof verification are different operations. A publisher signature, even when implemented correctly, would identify a publisher under a key policy—not prove consensus or true ledger state.

## Missing gates and the next finite experiment

The useful next experiment is a separately reviewed, offline **authenticated-publication manifest** layered on the fixed commitment tuple. It should use explicit test-only publisher trust, canonical bytes and versioned domains, and reject altered network, ledger, header, root, key or value, wrong publisher, wrong relation/version and unsupported key rotation. Verification must not accept a trust key supplied by the witness. Positive signature verification would establish only publisher attribution; state validity and consensus anchoring would remain conditional. This is a proposal, not a completed signature experiment or a request to use production keys.

Before a genuine state prover is selected, remaining work includes:

- A justified network/checkpoint anchor policy: validated externalization and header binding under an explicit quorum policy, or an openly trusted synced-Core observer with independently established provenance. SDF HTTPS agreement is not that cryptographic result.
- A modern protocol-specific native-state relation, complete bounded witness and independently checked temporal/deletion semantics, including live/hot-archive behavior where applicable.
- A chosen proof system, sound relation, setup/verification-key provenance, digest-to-field encoding and independently operated generation. An auxiliary index root needs proof of its derivation from native state; its own commitment is insufficient.
- A compatible contract verifier with genuine proof inputs, authorization/storage/transaction resource accounting and reviewed limits. The historical hash kernel cannot estimate these costs.
- Portable public fixture distribution and independent generator/oracle reproduction, without relabeling same-generator determinism as independent implementation.

Potential private-payment state checks remain a research motivation, not a privacy or cryptographic feature demonstrated by these experiments.

## Five-second target: no success result yet

No end-to-end proof-generation timing has been measured. A complete measurement must report these stages separately and identify their overlapping critical path:

1. Ledger close and trustworthy close-time/clock uncertainty.
2. Availability of an authenticated header/checkpoint and required state data.
3. Acquisition of complete witness data.
4. Witness preparation and native-state relation checks.
5. Proof generation under pinned parameters and resource limits.
6. Independent verification.
7. Authenticated publication and externally observable availability.

Report ledger-close-to-generation completion and publication availability separately, with warm/cold witness conditions, failures, timeouts, bytes, memory and concurrency. Checkpoint publication delay belongs in availability; a checkpoint-only experiment cannot establish every-ledger service. A fast hash, signature or pairing primitive cannot demonstrate the five-second goal. None of these unmeasured stages is replaced by the historical host counters above.
