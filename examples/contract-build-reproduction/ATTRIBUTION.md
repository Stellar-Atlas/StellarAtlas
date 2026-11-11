# Upstream attribution and derivation

This example derives `Cargo.toml` and `Cargo.lock` from
[Stellar CLI](https://github.com/stellar/stellar-cli) at commit
[`067b5a7c6084fdcd7900f2bf5d8af85df3898cae`](https://github.com/stellar/stellar-cli/tree/067b5a7c6084fdcd7900f2bf5d8af85df3898cae).

The pinned upstream [README](https://github.com/stellar/stellar-cli/blob/067b5a7c6084fdcd7900f2bf5d8af85df3898cae/README.md)
identifies Apache 2.0 licensing, and its
[CLI package manifest](https://github.com/stellar/stellar-cli/blob/067b5a7c6084fdcd7900f2bf5d8af85df3898cae/cmd/soroban-cli/Cargo.toml)
declares `license = "Apache-2.0"`. See the accompanying
[LICENSE-APACHE](LICENSE-APACHE) for the full Apache License, Version 2.0.
The pinned upstream Git tree contains no LICENSE, COPYING or NOTICE file;
this license text is the standard Apache-2.0 text, not a claimed copy of an
upstream license file. No upstream NOTICE has been omitted or invented.

Changes for this example:

- The root manifest's workspace `members` and `default-members` select only
  `cmd/crates/soroban-test/tests/fixtures/test-wasms/hello_world`. All other
  root manifest declarations are retained.
- The generated lock is narrowed to that workspace. Its external dependency
  versions, registry sources and checksums retain their upstream identities.
- `wasm-target.sha256` records checksums of the matching Rust 1.80.1
  `wasm32-unknown-unknown` target files. It contains no target binaries.

## Historical security warning

These pinned dependencies have known security advisories, including the
[Soroban contract macro dispatch issue](https://github.com/stellar/rs-soroban-sdk/security/advisories/GHSA-4chv-4c6w-w254)
and
[SDK range arithmetic issue](https://github.com/stellar/rs-soroban-sdk/security/advisories/GHSA-96xm-fv9w-pf3f).
They are preserved to identify historical reproducibility evidence, not as a
secure current development template or recommended dependency baseline for new
contracts or deployments. Run this recipe only in the developer guide's
credential-free, isolated, network-disabled sandbox; do not deploy its output.
Do not update the retained lock or hashes to clear an advisory: changed inputs
require a separately qualified recipe and new comparison evidence.

The example does not redistribute the complete upstream source tree,
dependency sources or tool binaries. Their applicable licenses and notices
must accompany any separate redistribution. The developer guide records the
historical recipe and controlled comparison limits.
