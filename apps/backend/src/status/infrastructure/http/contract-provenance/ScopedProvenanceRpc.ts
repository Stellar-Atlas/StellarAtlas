import { Networks } from '@stellar/stellar-sdk';
import { performance } from 'node:perf_hooks';
import { fetchProvenanceJson } from './BoundedProvenanceJson.js';
import { record } from './ContractBuildAttestation.js';
import {
	ContractRpcUnavailable,
	readContractCode,
	type ContractCodeObservation
} from './ContractRpcCode.js';

const RPC_DEADLINE_MS = 8_000;
const MAX_LEDGER_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;
const MAX_LEDGER_ADVANCE = 8;
const MAX_ACTIVE_READS = 2;
const OUTBOUND_WINDOW_MS = 10_000;
const MAX_OUTBOUND_CALLS = 4;
// Do not reuse a predecessor's remaining window on a non-overlapping restart.
const outboundStartsAfter = performance.now() + OUTBOUND_WINDOW_MS;
const outboundCalls: number[] = [];
let activeReads = 0;

function admitOutboundCall(): void {
	const now = performance.now();
	while (
		outboundCalls[0] !== undefined &&
		now - outboundCalls[0] >= OUTBOUND_WINDOW_MS
	) {
		outboundCalls.shift();
	}
	if (now < outboundStartsAfter || outboundCalls.length >= MAX_OUTBOUND_CALLS)
		throw new ContractRpcUnavailable(
			'Scoped provenance RPC rate budget exhausted'
		);
	// Charge attempts, including transport failures and provider errors.
	outboundCalls.push(now);
}

export interface ScopedProvenanceRpc {
	read(
		contractId: string
	): Promise<ContractCodeObservation & { freshUntil: number }>;
}

// The operator authorizes one exact HTTPS endpoint as a trusted observer of
// current state. Its network, close time and ledger entries are assertions,
// not a consensus or state proof. Never follow provider or client-supplied URLs.
export function scopedProvenanceRpc(
	configuredUrl: string,
	networkPassphrase: string,
	request: typeof fetchProvenanceJson = fetchProvenanceJson
): ScopedProvenanceRpc {
	const endpoint = exactHttpsUrl(configuredUrl);
	return {
		async read(contractId) {
			if (!endpoint || networkPassphrase !== Networks.PUBLIC)
				throw new ContractRpcUnavailable(
					'Scoped provenance RPC configuration is invalid'
				);
			if (activeReads >= MAX_ACTIVE_READS)
				throw new ContractRpcUnavailable(
					'Scoped provenance RPC capacity exhausted'
				);
			activeReads++;
			const deadline = performance.now() + RPC_DEADLINE_MS;
			let id = 0;
			const call = async (
				method: 'getNetwork' | 'getHealth' | 'getLedgerEntries',
				key?: string
			) => {
				const timeoutMs = Math.floor(deadline - performance.now());
				if (timeoutMs <= 0)
					throw new Error('Scoped provenance RPC deadline expired');
				const requestId = ++id;
				admitOutboundCall();
				const response = record(
					await request(
						endpoint,
						{
							jsonrpc: '2.0',
							id: requestId,
							method,
							...(key === undefined ? {} : { params: { keys: [key] } })
						},
						{
							timeoutMs,
							maxResponseBytes: key === undefined ? 16 * 1024 : 3 * 1024 * 1024
						}
					)
				);
				if (
					performance.now() >= deadline ||
					response.jsonrpc !== '2.0' ||
					response.id !== requestId ||
					response.error !== undefined
				)
					throw new Error('Invalid scoped provenance RPC response');
				return record(response.result);
			};
			try {
				const network = await call('getNetwork');
				if (
					network.passphrase !== Networks.PUBLIC ||
					!ledgerNumber(network.protocolVersion)
				)
					throw new Error('Scoped provenance RPC mainnet identity mismatch');
				const health = await call('getHealth');
				const { latestLedger, latestLedgerCloseTime } = health;
				if (
					health.status !== 'healthy' ||
					!ledgerNumber(latestLedger) ||
					typeof latestLedgerCloseTime !== 'string' ||
					!/^\d{1,10}$/.test(latestLedgerCloseTime)
				)
					throw new Error('Invalid scoped provenance RPC health evidence');
				const closedAt = Number(latestLedgerCloseTime) * 1_000;
				const freshUntil = closedAt + MAX_LEDGER_AGE_MS;
				const now = Date.now();
				if (freshUntil <= now || closedAt > now + MAX_FUTURE_SKEW_MS)
					throw new Error('Scoped provenance RPC close time is not current');
				let lastLedger = latestLedger;
				const observation = await readContractCode(
					endpoint,
					contractId,
					async (key) => {
						const result = await call('getLedgerEntries', key);
						const ledger = result.latestLedger;
						if (
							!ledgerNumber(ledger) ||
							ledger < lastLedger ||
							ledger > latestLedger + MAX_LEDGER_ADVANCE
						)
							throw new Error(
								'Scoped provenance RPC ledger evidence is inconsistent'
							);
						lastLedger = ledger;
						return result;
					}
				);
				if (Date.now() >= freshUntil || performance.now() >= deadline)
					throw new Error('Scoped provenance RPC evidence expired');
				return { ...observation, freshUntil };
			} catch {
				// A bad upstream must never become an attestation failure or use
				// the native RPC as a silent fallback.
				throw new ContractRpcUnavailable(
					'Scoped provenance RPC evidence is unavailable'
				);
			} finally {
				activeReads--;
			}
		}
	};
}

function ledgerNumber(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= 0xffffffff
	);
}

function exactHttpsUrl(value: string): URL | undefined {
	if (!/^https:\/\/[^\s\\?#]+$/.test(value)) return undefined;
	const authority = value.slice('https://'.length).split('/')[0];
	if (!authority || authority.includes('@')) return undefined;
	try {
		const url = new URL(value);
		if (url.hostname && !url.username && !url.password) return url;
	} catch {
		// A present but invalid setting disables evidence rather than falling back.
	}
	return undefined;
}
