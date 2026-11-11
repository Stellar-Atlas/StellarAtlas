import { Code, type DeveloperGuidePage } from './developer-guide-elements';
import {
	compareBuildCommands,
	offlineBuildCommands,
	reproductionExample as example
} from './contract-build-reproduction-example';

export const contractReproductionSection: DeveloperGuidePage['sections'][number] =
	{
		id: 'offline-reproduction',
		title: '5. Reproduce a controlled build offline',
		content: (
			<>
				<p>
					This historical example uses existing Cargo and Stellar tools. It
					requires no hosted executor or GitHub Actions.{' '}
					<strong>Build attested</strong> describes accepted signed provenance;
					independently reproduced describes a separate byte comparison. The
					provenance API does not run this recipe or return a reproduction
					status.
				</p>
				<p>
					<strong>Historical security warning.</strong> These pinned
					dependencies have known advisories, including the{' '}
					<a href="https://github.com/stellar/rs-soroban-sdk/security/advisories/GHSA-4chv-4c6w-w254">
						contract macro dispatch issue
					</a>{' '}
					and{' '}
					<a href="https://github.com/stellar/rs-soroban-sdk/security/advisories/GHSA-96xm-fv9w-pf3f">
						SDK range arithmetic issue
					</a>
					. This is not a secure current development template or recommended
					dependency baseline for new contracts or deployments. Run it only in
					the credential-free, isolated, network-disabled sandbox below; do not
					deploy its output. Retain the exact historical lock, tool and output
					identities for this comparison. Changed inputs require a separately
					qualified recipe and new comparison evidence.
				</p>
				<h3>Prepare and identify the inputs</h3>
				<p>
					Obtain the{' '}
					<a
						href={`https://github.com/stellar/stellar-cli/tree/${example.sourceCommit}`}
					>
						Stellar CLI source at commit {example.sourceCommit}
					</a>
					, preserving its upstream Apache-2.0 licensing. Use package{' '}
					<code>test_hello_world 21.3.0</code> at{' '}
					<code>
						cmd/crates/soroban-test/tests/fixtures/test-wasms/hello_world
					</code>
					. Keep the upstream contract, its manifest, the tracked{' '}
					<code>.cargo/config.toml</code> and the <code>test-wasms</code>{' '}
					profile unchanged. The SDK is pinned to{' '}
					<code>soroban-sdk =21.2.0</code>.
				</p>
				<p>
					In this repository, <code>examples/contract-build-reproduction/</code>{' '}
					supplies the exact derived root <code>Cargo.toml</code>,{' '}
					<code>Cargo.lock</code> and <code>wasm-target.sha256</code>. Replace
					only the upstream root manifest and lock with these files. The derived
					workspace selects this fixture alone; 154 external dependency
					identities retain their original versions, sources and checksums. It
					is a deliberately narrowed recipe, not an unchanged CLI workspace
					build.
				</p>
				<Code>{`# In the prepared upstream source root, after replacing the two files:
printf '%s  Cargo.toml\n%s  Cargo.lock\n' \\
 '${example.rootSha256}' \\
 '${example.lockSha256}' | sha256sum --check`}</Code>
				<p>
					Prepare a standard Cargo registry cache against this lock before
					disconnecting. The measured normal/build graph used 59 registry
					packages, including native build scripts and procedural macros;
					another 79 packages supported offline resolution/metadata, not the
					compiled feature graph. Keep package archives, extracted sources and
					registry index records. Check archive checksums against the lock. Do
					not fetch the unrelated full CLI workspace or replace registry sources
					with a different vendor configuration.
				</p>
				<p>
					Use Linux amd64 and the image digest below. Its native compiler is GCC
					12.2 with GNU ld 2.40. The image does not include the Wasm target:
					supply the matching Rust 1.80.1 <code>wasm32-unknown-unknown</code>{' '}
					target separately and check all 27 files with{' '}
					<code>sha256sum --check wasm-target.sha256</code> from its root.
					Supply the exact Stellar optimizer binary separately. These retained
					binary hashes identify the tested tools; rebuilding the same version
					string alone does not establish identical tool bytes.
				</p>
				<Code>{example.image}</Code>
				<table>
					<thead>
						<tr>
							<th>Tool</th>
							<th>SHA-256 of executable</th>
						</tr>
					</thead>
					<tbody>
						{example.tools.map(([tool, hash]) => (
							<tr key={tool}>
								<td>{tool}</td>
								<td>
									<code>{hash}</code>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				<p>
					The optimizer is{' '}
					<a
						href={`https://github.com/stellar/stellar-cli/blob/${example.sourceCommit}/cmd/soroban-cli/src/commands/contract/optimize.rs`}
					>
						Stellar CLI 21.3.0 with the opt feature
					</a>
					, embedding wasm-opt 0.114.2, aggressive size optimization and
					convergence, with MVP, MutableGlobals and SignExt. This CLI build does
					not accept modern <code>contract build --locked</code> or{' '}
					<code>--image</code> flags. Use the frozen Cargo step followed by the
					final optimizer below.
				</p>
				<h3>Build only from prepared inputs</h3>
				<p>
					For each attempt, start a fresh isolated container from the pinned
					image, with an empty target directory and fixed paths. Mount source
					read-only at <code>/source</code>, the prepared registry read-only at{' '}
					<code>/deps/registry</code>, and the optimizer read-only at{' '}
					<code>/tools/stellar</code>. Mount the checked target read-only at{' '}
					<code>
						/usr/local/rustup/toolchains/1.80.1-x86_64-unknown-linux-gnu/lib/rustlib/wasm32-unknown-unknown
					</code>
					. Make <code>/build</code> a fresh writable, executable 4 GiB tmpfs;
					native build scripts and procedural macros execute there.
				</p>
				<p>
					Run as UID/GID 1000:1000 with a read-only root filesystem, network
					disabled, private IPC, all capabilities dropped, no-new-privileges and
					the default seccomp policy. Limit each attempt to one CPU, 4 GiB
					memory with no additional swap, 128 PIDs and 15 minutes; cap logs at 8
					MiB and the final artifact at 1 MiB. Mount no credentials, Docker
					socket, reference artifact or previous output. Review source before
					allowing its build scripts to execute.
				</p>
				<p>
					The following are commands inside that prepared sandbox. Stop on any
					nonzero exit. Apply the displayed clean environment to both processes;
					unset ambient Rust flags, compiler wrappers and toolchain overrides.
					The tracked Cargo configuration remains active because the working
					directory is <code>/source</code>. Do not install tools, pull images
					or download dependencies during this phase.
				</p>
				<Code>{offlineBuildCommands}</Code>
				<h3>Compare the final bytes</h3>
				<p>
					Export the final optimized file before removing each container. Save
					the source, recipe, tool and dependency identities with the output.
					Compare the entire final files, including metadata and custom
					sections; a digest is a useful identity check, while <code>cmp</code>{' '}
					performs the full-byte comparison.
				</p>
				<Code>{compareBuildCommands}</Code>
				<table>
					<thead>
						<tr>
							<th>Controlled output</th>
							<th>Bytes</th>
							<th>SHA-256</th>
							<th>Comparison</th>
						</tr>
					</thead>
					<tbody>
						{example.results.map(([label, bytes, hash, result]) => (
							<tr key={label}>
								<td>{label}</td>
								<td>{bytes}</td>
								<td>
									<code>{hash}</code>
								</td>
								<td>{result}</td>
							</tr>
						))}
					</tbody>
				</table>
				<p>
					A and B were actual separate clean builds on the same operator’s host.
					C changed only the first <code>symbol_short!("Hello")</code> literal
					to <code>symbol_short!("Hallo")</code> before another successful
					build. The last row appended an empty custom section to A without
					another build. All four outputs passed WebAssembly structural/type
					validation; no Soroban host loading or contract invocation was tested.
				</p>
				<p>
					A is a newly authored local reference, not a publisher artifact or a
					deployed contract. B matching A demonstrates repeatability under these
					controlled inputs. It does not establish independent operators, source
					authenticity, compiler correctness, safe behavior or a security audit.
					Fresh-machine bootstrap, current-network compatibility, publisher
					attestation and deployed identity were not tested.
				</p>
				<p>
					Record <code>not_run</code> when a required input is missing, the
					recipe is invalid, a build or optimizer fails, or a timeout prevents a
					final comparison. Only successful final outputs can yield a match or
					mismatch; a mismatch alone does not establish malicious behavior. If
					exact historical inputs cannot be obtained, retain{' '}
					<code>not_run</code> for this recipe and qualify a different pinned
					recipe with its own reference.
				</p>
			</>
		)
	};
