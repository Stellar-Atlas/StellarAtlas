import { jest } from '@jest/globals';
import { mkdtemp, writeFile, unlink, rmdir, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair } from '@stellar/stellar-sdk';
import type { PathLike, Stats } from 'node:fs';

const native = await import('node:fs');
const supportedFile = '/etc/stellaratlas/account-verification/server.seed';
const parents = ['/', '/etc', '/etc/stellaratlas', '/etc/stellaratlas/account-verification'];
let fixtureFile = '', parentPatch: Partial<Stats> = {};
const inspect = jest.fn<(path: PathLike) => Stats>((path) => {
	if (path === supportedFile) return native.lstatSync(fixtureFile);
	if (!parents.includes(String(path))) throw new Error('Unexpected path');
	return Object.assign(native.statSync(tmpdir()), { uid: 0, mode: 0o40755 },
		path === parents.at(-1) ? parentPatch : {});
});
const open = jest.fn<(path: PathLike, flags: number) => number>((path, flags) => {
	if (path !== supportedFile) throw new Error('Unexpected path');
	return native.openSync(fixtureFile, flags);
});
const descriptor = jest.fn<(fd: number) => Stats>((fd) => native.fstatSync(fd));
const read = jest.fn<typeof native.readSync>(native.readSync);
jest.unstable_mockModule('node:fs', () => ({
	...native, lstatSync: inspect, openSync: open, fstatSync: descriptor, readSync: read
}));
const { verificationAuthConfig, verificationSigningFile } = await import('../VerificationAuthConfig.js');

beforeEach(() => {
	parentPatch = {};
	inspect.mockClear(); open.mockClear(); descriptor.mockClear(); read.mockClear();
});

it('requires an existing protected matching server key and explicitly selected reviewers, with no credential fallback', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'atlas-verification-auth-config-'));
	const file = join(dir, 'test-only-seed');
	const server = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
	const reviewer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
	try {
		await writeFile(file, server.secret(), { mode: 0o600 });
		fixtureFile = file;
		expect(verificationSigningFile).toBe(supportedFile);
		const env: NodeJS.ProcessEnv = {
			ATLAS_VERIFICATION_ORIGIN: 'https://atlas.example.org',
			ATLAS_VERIFICATION_HORIZON_MAINNET_URL: 'https://horizon.example.org/',
			ATLAS_VERIFICATION_SERVER_SEED_FILE: supportedFile,
			ATLAS_VERIFICATION_SERVER_ACCOUNT: server.publicKey(),
			ATLAS_VERIFICATION_REVIEWERS: JSON.stringify([
				{ network: 'mainnet', address: reviewer.publicKey() }
			])
		};
		const { config } = verificationAuthConfig(env);
		expect(open.mock.calls[0]?.[0]).toBe(supportedFile);
		expect([...config.reviewers]).toEqual([
			'stellar:mainnet:' + reviewer.publicKey()
		]);
		expect(config.networks.has('testnet')).toBe(false);
		for (const patch of [
			{ ATLAS_VERIFICATION_REVIEWERS: '[]' },
			{
				ATLAS_VERIFICATION_REVIEWERS: undefined,
				SCANNER_PASSWORD: 'must-not-work'
			},
			{ ATLAS_VERIFICATION_SERVER_ACCOUNT: reviewer.publicKey() },
			{ ATLAS_VERIFICATION_ORIGIN: 'http://atlas.example.org' },
			{
				ATLAS_VERIFICATION_REVIEWERS: JSON.stringify([
					{ network: 'testnet', address: reviewer.publicKey() }
				])
			}
		])
			expect(() => verificationAuthConfig({ ...env, ...patch })).toThrow(
				'configured trusted challenge'
			);
		if (process.platform !== 'win32') {
			await chmod(file, 0o644);
			expect(() => verificationAuthConfig(env)).toThrow(
				'protected server seed'
			);
		}
	} finally {
		await unlink(file);
		await rmdir(dir);
	}
});

it('rejects other paths and unsafe ancestors before opening any signing file', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'atlas-verification-path-'));
	fixtureFile = join(dir, 'test-only-seed');
	const server = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
	const reviewer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
	const env = {
		ATLAS_VERIFICATION_ORIGIN: 'https://atlas.example.org',
		ATLAS_VERIFICATION_HORIZON_MAINNET_URL: 'https://horizon.example.org/',
		ATLAS_VERIFICATION_SERVER_SEED_FILE: supportedFile,
		ATLAS_VERIFICATION_SERVER_ACCOUNT: server.publicKey(),
		ATLAS_VERIFICATION_REVIEWERS: JSON.stringify([{ network: 'mainnet', address: reviewer.publicKey() }])
	};
	try {
		await writeFile(fixtureFile, server.secret(), { mode: 0o600 });
		for (const path of [undefined, fixtureFile, 'server.seed', '/tmp/server.seed',
			'/etc/stellaratlas/account-verification/../account-verification/server.seed']) {
			expect(() => verificationAuthConfig({ ...env, ATLAS_VERIFICATION_SERVER_SEED_FILE: path })).toThrow();
			expect(open).not.toHaveBeenCalled();
		}
		for (const patch of [{ uid: 1 }, { mode: 0o40777 }, { mode: 0o120777 }]) {
			parentPatch = patch;
			expect(() => verificationAuthConfig(env)).toThrow();
			expect(open).not.toHaveBeenCalled();
		}
		parentPatch = {};
		descriptor.mockImplementationOnce((fd) => {
			const info = native.fstatSync(fd);
			info.mode = 0o100644;
			return info;
		});
		expect(() => verificationAuthConfig(env)).toThrow();
		expect(open).toHaveBeenCalledTimes(1);
		expect(read).not.toHaveBeenCalled();
	} finally {
		await unlink(fixtureFile); await rmdir(dir);
	}
});

it('rejects linked or oversized leaf files without reading another credential', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'atlas-verification-leaf-'));
	fixtureFile = join(dir, 'test-only-seed');
	const alias = join(dir, 'test-only-alias');
	const server = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
	const env = {
		ATLAS_VERIFICATION_ORIGIN: 'https://atlas.example.org',
		ATLAS_VERIFICATION_HORIZON_MAINNET_URL: 'https://horizon.example.org/',
		ATLAS_VERIFICATION_SERVER_SEED_FILE: supportedFile,
		ATLAS_VERIFICATION_SERVER_ACCOUNT: server.publicKey(),
		ATLAS_VERIFICATION_REVIEWERS: JSON.stringify([{ network: 'mainnet', address: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey() }])
	};
	try {
		await writeFile(fixtureFile, server.secret(), { mode: 0o600 });
		await link(fixtureFile, alias);
		expect(() => verificationAuthConfig(env)).toThrow();
		expect(read).not.toHaveBeenCalled();
		await unlink(alias);
		for (const value of ['', 'x'.repeat(129)]) {
			await writeFile(fixtureFile, value);
			expect(() => verificationAuthConfig(env)).toThrow();
			expect(read).not.toHaveBeenCalled();
		}
	} finally {
		await unlink(fixtureFile); await rmdir(dir);
	}
});
