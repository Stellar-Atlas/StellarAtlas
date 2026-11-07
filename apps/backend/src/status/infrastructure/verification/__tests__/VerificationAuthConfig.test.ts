import { mkdtemp, writeFile, unlink, rmdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair } from '@stellar/stellar-sdk';
import { verificationAuthConfig } from '../VerificationAuthConfig.js';

it('requires an existing protected matching server key and explicitly selected reviewers, with no credential fallback', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'atlas-verification-auth-config-'));
	const file = join(dir, 'test-only-seed');
	const server = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
	const reviewer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
	try {
		await writeFile(file, server.secret(), { mode: 0o600 });
		const env: NodeJS.ProcessEnv = {
			ATLAS_VERIFICATION_ORIGIN: 'https://atlas.example.org',
			ATLAS_VERIFICATION_HORIZON_MAINNET_URL: 'https://horizon.example.org/',
			ATLAS_VERIFICATION_SERVER_SEED_FILE: file,
			ATLAS_VERIFICATION_SERVER_ACCOUNT: server.publicKey(),
			ATLAS_VERIFICATION_REVIEWERS: JSON.stringify([
				{ network: 'mainnet', address: reviewer.publicKey() }
			])
		};
		const { config } = verificationAuthConfig(env);
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
