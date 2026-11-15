// Usage: node scripts/prepare-hubble-native-companion.mjs ORIGINAL_ARCHIVE FRESH_OUTPUT
// Requires GNU objcopy 2.42. Consume the output only in an isolated build view;
// preserve upstream go.sum/cache and retain this helper's JSON provenance.
// Run from the private build workspace containing both paths and an output subdirectory. Neither path may
// escape that workspace, including through a symbolic link.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, link, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const originalSha256 = '32c435870e65c9ff1d033c76adc63068ca99e41f9b4af04193bc1f71f39959f0';
const companionSha256 = '9c8574998fc6c0dd91bde7ed2e09b7471b5286dad99b384a8cb8c4ae797a2959';
const originalBytes = 31_908_636;
const companionBytes = 24_150_980;
const moduleVersion = 'v0.0.0-20260818190510-707287dd9837';

try {
	await prepare();
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Native companion preparation failed');
	process.exitCode = 1;
}

async function prepare() {
	if (process.argv.length !== 4 || process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error('Expected Linux x64 and two arguments: ORIGINAL_ARCHIVE FRESH_OUTPUT');
	}
	const workspace = await realpath(process.cwd());
	const requestedOriginal = resolve(workspace, process.argv[2]);
	if (!requestedOriginal.startsWith(workspace + sep)) {
		throw new Error('Original archive must be inside the build workspace');
	}
	const original = await realpath(requestedOriginal);
	if (!original.startsWith(workspace + sep)) {
		throw new Error('Original archive symlink leaves the build workspace');
	}
	const suffix = join('xdrjson', 'libs', 'x86_64-unknown-linux-gnu', 'libxdrjson.a');
	if (!original.endsWith(`${sep}${suffix}`)) throw new Error('Unexpected native archive layout');
	const sourceRoot = resolve(dirname(original), '../../..');
	const requestedDirectory = resolve(workspace, dirname(process.argv[3]));
	if (!requestedDirectory.startsWith(workspace + sep)) {
		throw new Error('Output directory must be inside the build workspace');
	}
	const outputDirectory = await realpath(requestedDirectory);
	if (!outputDirectory.startsWith(workspace + sep)) {
		throw new Error('Output directory symlink leaves the build workspace');
	}
	const output = join(outputDirectory, basename(process.argv[3]));
	const withinSource = relative(sourceRoot, output);
	if (!withinSource.startsWith(`..${sep}`) && !isAbsolute(withinSource)) {
		throw new Error('Output must be outside the original module source/cache tree');
	}
	const information = await stat(original);
	if (!information.isFile() || information.size !== originalBytes || await hash(original) !== originalSha256) {
		throw new Error('Original archive identity does not match the reviewed pinned module');
	}
	const version = execute(['--version']);
	if (!/^GNU objcopy \(GNU Binutils[^\r\n]*\) 2\.42\r?\n/.test(version)) {
		throw new Error('The reviewed recipe requires GNU objcopy 2.42');
	}
	// Hash pinning binds the reviewed native-section/symbol/relocation invariants,
	// including the explicitly reviewed ELF writer and conservative ICF metadata changes.
	const temporary = await mkdtemp(join(outputDirectory, '.hubble-native-'));
	try {
		const input = join(temporary, 'original.a');
		const derived = join(temporary, 'companion.a');
		const repeated = join(temporary, 'repeat.a');
		await copyFile(original, input, constants.COPYFILE_EXCL);
		if (await hash(input) !== originalSha256) throw new Error('Original archive changed while copying');
		for (const destination of [derived, repeated]) {
			execute(['--remove-section=.llvmbc', '--remove-section=.llvmcmd', input, destination]);
			if ((await stat(destination)).size !== companionBytes || await hash(destination) !== companionSha256) {
				throw new Error('Derived archive does not match the reviewed native companion');
			}
		}
		if (await hash(original) !== originalSha256) throw new Error('Original archive changed during preparation');
		await chmod(derived, 0o444);
		// Exclusive publication: never replace an existing file or follow an output symlink.
		await link(derived, output);
		console.log(JSON.stringify({
			schemaVersion: 1,
			module: 'github.com/stellar/go-stellar-xdr-json',
			moduleVersion,
			target: 'x86_64-unknown-linux-gnu',
			originalSha256,
			companionSha256,
			originalBytes,
			companionBytes,
			tool: { name: 'GNU objcopy', version: '2.42' },
			removedSections: ['.llvmbc', '.llvmcmd'],
			deterministicRepeatVerified: true,
			upstreamSourceAndChecksumPreserved: true,
			metadataPolicy: 'Reviewed pinned ELF writer canonicalizations and conservative empty ADDRSIG handling'
		}));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

function execute(args) {
	const result = spawnSync('objcopy', args, {
		encoding: 'utf8',
		timeout: 60_000,
		maxBuffer: 64 * 1024,
		env: { ...process.env, LC_ALL: 'C' }
	});
	if (result.error || result.status !== 0) throw new Error('GNU objcopy failed; no companion was accepted');
	return result.stdout;
}

async function hash(path) {
	const digest = createHash('sha256');
	for await (const chunk of createReadStream(path)) digest.update(chunk);
	return digest.digest('hex');
}
