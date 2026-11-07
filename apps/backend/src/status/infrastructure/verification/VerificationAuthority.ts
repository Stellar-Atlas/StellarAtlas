import { Networks, StrKey, type Horizon } from '@stellar/stellar-sdk';
import { readHorizonAccountJson } from '../../../network-scan/infrastructure/http/HorizonAccountResponse.js';
import { createHash } from 'node:crypto';
import {
	record,
	target,
	VerificationError,
	type Network
} from './VerificationApplication.js';

export const passphrase = (network: Network): string =>
	network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
export interface AccountAuthority {
	readonly network: Network;
	readonly address: string;
	readonly threshold: number;
	readonly signers: Horizon.ServerApi.AccountRecordSigners[];
	readonly ledger: number;
	readonly observedAt: string;
	readonly digest: string;
}
export type AuthorityReader = (
	network: Network,
	address: string
) => Promise<AccountAuthority>;
function integer(value: unknown, max: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max)
		throw new VerificationError(
			503,
			'Current account authority is unavailable'
		);
	return Number(value);
}
export function authorityFromRecord(
	value: unknown,
	network: Network,
	address: string,
	ledger: number,
	now: Date
): AccountAuthority {
	const row = record(value);
	const thresholds = record(row.thresholds);
	if (
		row.account_id !== address ||
		!Array.isArray(row.signers) ||
		row.signers.length < 1 ||
		row.signers.length > 21 ||
		integer(row.last_modified_ledger, 0xffffffff) > ledger
	)
		throw new VerificationError(
			503,
			'Current account authority is unavailable'
		);
	const signers = row.signers
		.map((value): Horizon.ServerApi.AccountRecordSigners => {
			const signer = record(value);
			if (
				signer.type !== 'ed25519_public_key' ||
				typeof signer.key !== 'string' ||
				!StrKey.isValidEd25519PublicKey(signer.key)
			)
				throw new VerificationError(
					403,
					'Only accounts with Ed25519 signers are supported'
				);
			return {
				key: signer.key,
				weight: integer(signer.weight, 255),
				type: 'ed25519_public_key'
			};
		})
		.sort((a, b) => a.key.localeCompare(b.key));
	if (new Set(signers.map((signer) => signer.key)).size !== signers.length)
		throw new VerificationError(503, 'Invalid account signer evidence');
	const threshold = Math.max(
		1,
		integer(thresholds.low_threshold, 255),
		integer(thresholds.med_threshold, 255),
		integer(thresholds.high_threshold, 255)
	);
	const digest = createHash('sha256')
		.update(JSON.stringify({ network, address, threshold, signers }))
		.digest('hex');
	return {
		network,
		address,
		threshold,
		signers,
		ledger,
		observedAt: now.toISOString(),
		digest
	};
}
/** Operator-owned endpoint only; no caller-selected authority, redirect or fallback. */
export function createAuthorityReader(
	endpoints: ReadonlyMap<Network, string>,
	transport: typeof fetch = fetch,
	now: () => Date = () => new Date()
): AuthorityReader {
	const urls = new Map<Network, URL>();
	for (const [network, value] of endpoints) {
		const url = new URL(value);
		if (
			(url.protocol !== 'https:' &&
				!(
					url.protocol === 'http:' &&
					['127.0.0.1', '[::1]'].includes(url.hostname)
				)) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			/[\\\s]/.test(value)
		)
			throw new Error('Invalid verification Horizon endpoint');
		if (!url.pathname.endsWith('/')) url.pathname += '/';
		urls.set(network, url);
	}
	return async (network, address) => {
		target(network, address);
		const base = urls.get(network);
		if (!base)
			throw new VerificationError(
				403,
				'This verification network is not configured'
			);
		const signal = AbortSignal.timeout(8000);
		const get = async (path: string) => {
			const response = await transport(new URL(path, base), {
				redirect: 'error',
				cache: 'no-store',
				signal,
				headers: { Accept: 'application/json' }
			});
			if (response.status !== 200) {
				await response.body?.cancel();
				throw new VerificationError(
					503,
					'Current account authority is unavailable'
				);
			}
			return {
				response,
				value: await readHorizonAccountJson(response, signal)
			};
		};
		const root = record((await get('')).value);
		if (root.network_passphrase !== passphrase(network))
			throw new VerificationError(503, 'Account authority network mismatch');
		const account = await get('accounts/' + address);
		const ledgerText = account.response.headers.get('Latest-Ledger');
		if (!ledgerText || !/^[1-9][0-9]{0,9}$/.test(ledgerText))
			throw new VerificationError(
				503,
				'Account ledger evidence is unavailable'
			);
		const sequence = integer(Number(ledgerText), 0xffffffff);
		if (integer(root.history_latest_ledger, 0xffffffff) > sequence)
			throw new VerificationError(
				503,
				'Account authority is behind the observed network'
			);
		const ledger = record((await get('ledgers/' + sequence)).value);
		const at = now();
		const age =
			typeof ledger.closed_at === 'string'
				? at.getTime() - Date.parse(ledger.closed_at)
				: NaN;
		if (
			ledger.sequence !== sequence ||
			!Number.isFinite(age) ||
			age < 0 ||
			age > 30_000
		)
			throw new VerificationError(503, 'Current account authority is stale');
		return authorityFromRecord(account.value, network, address, sequence, at);
	};
}
