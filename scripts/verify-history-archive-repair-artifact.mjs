import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const digestPattern = /^[0-9a-f]{64}$/;
const defaultMaxCompressedBytes = 2 * 1024 ** 3;
const defaultMaxJsonBytes = 4 * 1024 ** 2;
const defaultMaxUncompressedBytes = 8 * 1024 ** 3;
const maxCanonicalJsonDepth = 64;
const maxCanonicalJsonNodes = 100_000;

export async function verifyHistoryArchiveRepairArtifact(options) {
	const normalized = normalizeOptions(options);
	const handle = await open(
		normalized.filePath,
		constants.O_RDONLY | constants.O_NOFOLLOW
	);
	try {
		const before = await handle.stat();
		if (!before.isFile()) throw new Error('Artifact is not a regular file');
		if (before.size > normalized.maxCompressedBytes) {
			throw new Error('Artifact exceeds the compressed-byte safety limit');
		}
		if (
			normalized.expectedByteLength !== null &&
			before.size !== normalized.expectedByteLength
		) {
			throw new Error(
				`Artifact byte length ${before.size} does not match ${normalized.expectedByteLength}`
			);
		}

		const actualDigest =
			normalized.representation === 'canonical-json'
				? await hashCanonicalJson(handle, before.size, normalized.maxJsonBytes)
				: await hashUncompressedXdr(
						handle,
						before.size,
						normalized.maxUncompressedBytes
					);
		const after = await handle.stat();
		if (!sameFileVersion(before, after)) {
			throw new Error('Artifact changed during verification');
		}
		if (actualDigest !== normalized.expectedDigest) {
			throw new Error(
				`Artifact ${normalized.representation} SHA-256 ${actualDigest} does not match ${normalized.expectedDigest}`
			);
		}
		return {
			byteLength: before.size,
			digest: actualDigest,
			representation: normalized.representation
		};
	} finally {
		await handle.close();
	}
}

async function hashCanonicalJson(handle, byteLength, maxJsonBytes) {
	if (byteLength > maxJsonBytes) {
		throw new Error('JSON artifact exceeds the canonicalization safety limit');
	}
	const value = JSON.parse(
		new TextDecoder('utf-8', { fatal: true }).decode(await readFile(handle))
	);
	assertBoundedCanonicalJson(value);
	return createHash('sha256')
		.update(JSON.stringify(sortJson(value)))
		.digest('hex');
}

function assertBoundedCanonicalJson(value) {
	const pending = [{ depth: 0, value }];
	let nodes = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		nodes++;
		if (
			nodes > maxCanonicalJsonNodes ||
			current.depth > maxCanonicalJsonDepth
		) {
			throw new Error(
				'JSON artifact exceeds the canonicalization structure limit'
			);
		}
		if (typeof current.value !== 'object' || current.value === null) continue;
		for (const child of Object.values(current.value)) {
			pending.push({ depth: current.depth + 1, value: child });
		}
	}
}

async function hashUncompressedXdr(handle, byteLength, maxUncompressedBytes) {
	const hash = createHash('sha256');
	await pipeline(
		handle.createReadStream({
			autoClose: false,
			end: byteLength - 1,
			start: 0
		}),
		createGunzip(),
		new ByteLimitTransform(maxUncompressedBytes),
		hash
	);
	return hash.digest('hex');
}

function sortJson(value) {
	if (Array.isArray(value)) return value.map(sortJson);
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.keys(value)
			.toSorted()
			.map((key) => [key, sortJson(value[key])])
	);
}

function normalizeOptions(options) {
	if (typeof options?.filePath !== 'string' || options.filePath.length === 0) {
		throw new Error('A staged artifact file path is required');
	}
	const expectedDigest = String(options.expectedDigest ?? '').toLowerCase();
	if (!digestPattern.test(expectedDigest)) {
		throw new Error('Expected digest must be a lowercase SHA-256 value');
	}
	if (
		options.representation !== 'canonical-json' &&
		options.representation !== 'uncompressed-xdr'
	) {
		throw new Error('Unsupported content representation');
	}
	const expectedByteLength =
		options.expectedByteLength === undefined ||
		options.expectedByteLength === null
			? null
			: requireNonNegativeInteger(options.expectedByteLength, 'byte length');
	return {
		expectedByteLength,
		expectedDigest,
		filePath: options.filePath,
		maxCompressedBytes: positiveLimit(
			options.maxCompressedBytes,
			defaultMaxCompressedBytes
		),
		maxJsonBytes: positiveLimit(options.maxJsonBytes, defaultMaxJsonBytes),
		maxUncompressedBytes: positiveLimit(
			options.maxUncompressedBytes,
			defaultMaxUncompressedBytes
		),
		representation: options.representation
	};
}

function parseArguments(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith('--') || value === undefined || values.has(key)) {
			throw new Error('Arguments must be unique --name value pairs');
		}
		values.set(key, value);
	}
	for (const key of values.keys()) {
		if (
			!['--byte-length', '--digest', '--file', '--representation'].includes(key)
		) {
			throw new Error(`Unknown argument ${key}`);
		}
	}
	return {
		expectedByteLength: values.has('--byte-length')
			? requireNonNegativeInteger(values.get('--byte-length'), 'byte length')
			: null,
		expectedDigest: values.get('--digest'),
		filePath: values.get('--file'),
		representation: values.get('--representation')
	};
}

function requireNonNegativeInteger(value, label) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new Error(`Expected ${label} must be a non-negative integer`);
	}
	return number;
}

function positiveLimit(value, fallback) {
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sameFileVersion(before, after) {
	return (
		before.dev === after.dev &&
		before.ino === after.ino &&
		before.size === after.size &&
		before.mtimeMs === after.mtimeMs &&
		before.ctimeMs === after.ctimeMs
	);
}

class ByteLimitTransform extends Transform {
	bytes = 0;

	constructor(maximumBytes) {
		super();
		this.maximumBytes = maximumBytes;
	}

	_transform(chunk, _encoding, callback) {
		this.bytes += chunk.byteLength;
		if (this.bytes > this.maximumBytes) {
			callback(
				new Error('Artifact exceeds the uncompressed-byte safety limit')
			);
			return;
		}
		callback(null, chunk);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const result = await verifyHistoryArchiveRepairArtifact(
			parseArguments(process.argv.slice(2))
		);
		process.stdout.write(
			`verified ${result.representation} SHA-256 ${result.digest}; ${result.byteLength} transport bytes\n`
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : 'Artifact verification failed'}\n`
		);
		process.exitCode = 1;
	}
}
