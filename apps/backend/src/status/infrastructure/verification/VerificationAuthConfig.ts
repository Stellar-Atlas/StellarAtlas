import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	type Stats
} from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { record, target, type Network } from './VerificationApplication.js';
import {
	principal,
	type StellarAuthConfig
} from './VerificationStellarAuth.js';

export const verificationSigningFile =
	'/etc/stellaratlas/account-verification/server.seed';
function protectedSigningFile(info: Stats): boolean {
	return info.isFile() && info.nlink === 1 && info.size > 0 && info.size <= 128 &&
		(info.mode & 0o077) === 0 &&
		(info.uid === 0 || info.uid === process.getuid?.());
}

export function verificationAuthConfig(environment: NodeJS.ProcessEnv): {
	config: StellarAuthConfig;
	endpoints: ReadonlyMap<Network, string>;
} {
	try {
		const origin = new URL(environment.ATLAS_VERIFICATION_ORIGIN ?? '');
		if (
			origin.protocol !== 'https:' ||
			origin.origin !== environment.ATLAS_VERIFICATION_ORIGIN ||
			origin.port ||
			!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(
				origin.hostname
			) ||
			origin.hostname.length > 58
		)
			throw new Error();
		const homeDomain =
			environment.ATLAS_VERIFICATION_HOME_DOMAIN ?? origin.hostname;
		if (homeDomain !== origin.hostname) throw new Error();
		const endpoints = new Map<Network, string>();
		for (const network of ['mainnet', 'testnet'] as const) {
			const value =
				environment[`ATLAS_VERIFICATION_HORIZON_${network.toUpperCase()}_URL`];
			if (value) endpoints.set(network, value);
		}
		if (!endpoints.size) throw new Error();
		const raw: unknown = JSON.parse(
			environment.ATLAS_VERIFICATION_REVIEWERS ?? 'null'
		);
		if (!Array.isArray(raw) || !raw.length || raw.length > 16)
			throw new Error();
		const reviewers = new Set<string>();
		for (const value of raw) {
			const row = record(value);
			if (Object.keys(row).some((key) => !['network', 'address'].includes(key)))
				throw new Error();
			const account = target(row.network, row.address);
			if (!endpoints.has(account.network)) throw new Error();
			reviewers.add(principal(account.network, account.address));
		}
		if (reviewers.size !== raw.length) throw new Error();
		if (environment.ATLAS_VERIFICATION_SERVER_SEED_FILE !== verificationSigningFile)
			throw new Error();
		for (const parent of ['/', '/etc', '/etc/stellaratlas', '/etc/stellaratlas/account-verification']) {
			const info = lstatSync(parent);
			if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022) !== 0)
				throw new Error();
		}
		const fd = openSync(
			'/etc/stellaratlas/account-verification/server.seed',
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
		);
		let server: Keypair;
		try {
			const stat = fstatSync(fd);
			if (!protectedSigningFile(stat))
				throw new Error();
			const bytes = Buffer.alloc(129);
			const count = readSync(fd, bytes, 0, bytes.length, 0);
			if (count !== stat.size || fstatSync(fd).size !== stat.size)
				throw new Error();
			server = Keypair.fromSecret(bytes.subarray(0, count).toString('utf8').trim());
		} finally {
			closeSync(fd);
		}
		if (
			server.publicKey() !== environment.ATLAS_VERIFICATION_SERVER_ACCOUNT ||
			[...reviewers].some((value) => value.endsWith(':' + server.publicKey()))
		)
			throw new Error();
		return {
			config: {
				origin: origin.origin,
				homeDomain,
				server,
				networks: new Set(endpoints.keys()),
				reviewers
			},
			endpoints
		};
	} catch {
		throw new Error(
			'Atlas verification requires configured trusted challenge authentication, an existing protected server seed, Horizon endpoints and explicit reviewers'
		);
	}
}
