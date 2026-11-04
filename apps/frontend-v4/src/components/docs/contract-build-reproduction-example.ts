export const reproductionExample = {
	sourceCommit: '067b5a7c6084fdcd7900f2bf5d8af85df3898cae',
	image:
		'docker.io/library/rust@sha256:883df89a3ed53fb0e0f6a67d79cfebf72906d97f9d816379fdf941af969be1b5',
	rootSha256:
		'cd8cc44a5c0b8cd814fe572db1ee2e13d5900576266091aa4fa8e35d8d329cb0',
	lockSha256:
		'a9322ef77cbd1b45e6aea5e71474dcdd02ef6058d605c4895f8fa1d2fec88954',
	tools: [
		[
			'rustc 1.80.1 (3f5fd8dd4 2024-08-06)',
			'0989d3ded21082db4f63935ad73fefeee8e7881a8b1bcb19a84800e63e2049aa'
		],
		[
			'cargo 1.80.1 (376290515 2024-07-16)',
			'9d42d3b2535ed528f59f537d01ecdfc821ef30562495a9341c08c756d2b31c40'
		],
		[
			'Stellar CLI 21.3.0, opt feature',
			'6bbb96f3cd230543fb5c19e8c5bda5a24bb6da8b9502659a07aa3af2e4441f26'
		]
	],
	results: [
		[
			'A: newly authored local reference',
			2837,
			'03cf774f7ddddd0e07dcff76321da10fe735b87bf15bbfa200c0de7e986eb19d',
			'Reference only'
		],
		[
			'B: clean rebuild of A source',
			2837,
			'03cf774f7ddddd0e07dcff76321da10fe735b87bf15bbfa200c0de7e986eb19d',
			'Full-byte match with A'
		],
		[
			'C: first Hello literal changed to Hallo',
			2986,
			'34ba5ea14258bf786d3f475b34e09e4a1a1ab6aebf812019e6c137667c7573d4',
			'Successful build; mismatch with A'
		],
		[
			'A plus empty custom section (00 01 00)',
			2840,
			'afd28eba60f8729ab347bcebfaa16f3d39b263f8313dd1566462bc468dd54446',
			'Valid Wasm; mismatch with B'
		]
	]
} as const;

export const offlineBuildCommands = `set -eu
mkdir -p /build/home /build/tmp /build/cargo-home /build/final
ln -s /deps/registry /build/cargo-home/registry
cd /source
run_clean() { env -i \\
 PATH=/usr/local/rustup/toolchains/1.80.1-x86_64-unknown-linux-gnu/bin:/usr/bin:/bin \\
 HOME=/build/home TMPDIR=/build/tmp CARGO_HOME=/build/cargo-home \\
 CARGO_TARGET_DIR=/build/target CARGO_NET_OFFLINE=true CARGO_BUILD_JOBS=1 \\
 RUSTC=/usr/local/rustup/toolchains/1.80.1-x86_64-unknown-linux-gnu/bin/rustc \\
 CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=/usr/bin/cc \\
 SOURCE_DATE_EPOCH=1723217212 TZ=UTC LANG=C "$@"; }
run_clean /usr/local/rustup/toolchains/1.80.1-x86_64-unknown-linux-gnu/bin/cargo rustc \\
 --frozen --offline \\
 --manifest-path=/source/cmd/crates/soroban-test/tests/fixtures/test-wasms/hello_world/Cargo.toml \\
 --package=test_hello_world --crate-type=cdylib \\
 --target=wasm32-unknown-unknown --profile=test-wasms

# Only after Cargo exits successfully, under the same clean environment:
run_clean /tools/stellar contract optimize \\
 --wasm=/build/target/wasm32-unknown-unknown/test-wasms/test_hello_world.wasm \\
 --wasm-out=/build/final/test_hello_world.optimized.wasm`;

export const compareBuildCommands = `# Export final optimized bytes only after each successful build.
sha256sum reference.wasm rebuilt.wasm
cmp --silent reference.wasm rebuilt.wasm
# cmp: 0 = exact match; 1 = mismatch; >1 = comparison error.
# Check its exit status; do not strip or normalize either file.`;
