//! Native Soroban host experiment, not a deployed/Wasm state-inclusion verifier.
//! The pinned digest represents an externally authorized publication. This test
//! does not establish who authorized it or whether its state claim is true.
use soroban_env_common::{Env, EnvBase};
use soroban_env_host::{Host, HostError, Compare};
use std::cmp::Ordering;

fn manifest() -> Vec<u8> {
    let mut bytes = b"AtlasAttestedStateClaim/v1\0".to_vec();
    bytes.extend_from_slice(&[1; 32]); // Synthetic network ID, not consensus proof.
    bytes.extend_from_slice(&63_u32.to_be_bytes());
    for value in 2..=5 { bytes.extend_from_slice(&[value; 32]); }
    bytes
}

fn accepts(host: &Host, claim: &[u8], pinned: &[u8]) -> Result<bool, HostError> {
    if claim.len() != 191 || pinned.len() != 32 { return Ok(false); }
    let input = host.bytes_new_from_slice(claim)?;
    let digest = host.compute_hash_sha256(input)?;
    let anchor = host.bytes_new_from_slice(pinned)?;
    Ok(host.compare(&digest, &anchor)? == Ordering::Equal)
}

#[test]
fn domain_bound_pinned_claim() {
    let bytes = manifest();
    let pin = hex::decode("83575b323dd4244713e5934e1f13ccb0adc9559281f35fb77915c41bd174b6d3").unwrap();
    let host = Host::default();
    host.budget_cloned().reset_default().unwrap();
    let start = std::time::Instant::now();
    assert!(accepts(&host, &bytes, &pin).unwrap());
    println!("MEASUREMENT claim_bytes={} anchor_bytes={} cpu_cost_units={} memory_cost_bytes={} elapsed_ns={}", bytes.len(), pin.len(), host.budget_cloned().get_cpu_insns_consumed().unwrap(), host.budget_cloned().get_mem_bytes_consumed().unwrap(), start.elapsed().as_nanos());
    // Change each bound field independently: domain, network, ledger, header,
    // native root, key commitment, value commitment.
    for offset in [0, 27, 59, 63, 95, 127, 159] {
        let mut changed = bytes.clone(); changed[offset] ^= 1;
        assert!(!accepts(&Host::default(), &changed, &pin).unwrap());
    }
    let mut wrong_pin = pin.clone(); wrong_pin[0] ^= 1;
    assert!(!accepts(&Host::default(), &bytes, &wrong_pin).unwrap());
    assert!(!accepts(&Host::default(), &bytes[..190], &pin).unwrap());
    let mut extra = bytes.clone(); extra.push(0);
    assert!(!accepts(&Host::default(), &extra, &pin).unwrap());
    assert!(!accepts(&Host::default(), &bytes, &pin[..31]).unwrap());
}
