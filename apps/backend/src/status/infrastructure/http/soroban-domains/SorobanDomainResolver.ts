import http from 'node:http';
import https from 'node:https';
import {
	Account,
	Contract,
	Networks,
	TransactionBuilder,
	xdr
} from '@stellar/stellar-sdk';
import { LRUCache } from 'lru-cache';
import { fetchRpcJson } from '../contract-provenance/BoundedProvenanceJson.js';
import type { RpcEndpoint } from '../contract-provenance/ProvenanceEndpointPolicy.js';
import {
	decodeRegistryRecord,
	registryRecordKey,
	REGISTRY_V2,
	type ExactDomainName,
	type SorobanDomainRecord
} from './SorobanDomainRecord.js';

// Public simulation source from the Creit SDK. No key or authorization is used.
const SIMULATION_ACCOUNT =
	'GALAXYVOIDAOPZTDLHILAJQKCVVFMD4IKLXLSZV5YHO7VY74IWZILUTO';
const SUCCESS_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 10_000;
const LOOKUP_TIMEOUT_MS = 9_000; // Leaves time for the Explorer's 12-second HTTP fetch.
const MAX_IN_FLIGHT = 2;
const MAX_WAITERS_PER_NAME = 16;

interface Observation {
	readonly name: string;
	readonly source: 'creit-soroban-domains-v2';
	readonly network: 'mainnet';
	readonly registry: typeof REGISTRY_V2;
	readonly observedLedger: number;
	readonly ledgerCloseTime: number;
	readonly observedAt: string;
}

export type SorobanDomainLookup = Observation &
	(
		| { readonly status: 'resolved'; readonly record: SorobanDomainRecord }
		| { readonly status: 'not_found' | 'expired' }
	);

export class SorobanDomainBusy extends Error {}

interface PendingLookup {
	readonly controller: AbortController;
	readonly promise: Promise<SorobanDomainLookup>;
	admitted: number;
	active: number;
}

export class SorobanDomainResolver {
	private readonly cache = new LRUCache<string, SorobanDomainLookup>({
		max: 256,
		ttlResolution: 0
	});
	private readonly pending = new Map<string, PendingLookup>();
	private readonly agent: http.Agent;

	constructor(
		private readonly rpc: RpcEndpoint,
		private readonly timeoutMs = LOOKUP_TIMEOUT_MS
	) {
		const Agent = rpc.protocol === 'https:' ? https.Agent : http.Agent;
		this.agent = new Agent({
			keepAlive: true,
			maxSockets: MAX_IN_FLIGHT,
			maxTotalSockets: MAX_IN_FLIGHT,
			maxFreeSockets: 1
		});
	}

	async resolve(
		domain: ExactDomainName,
		signal?: AbortSignal
	): Promise<SorobanDomainLookup> {
		signal?.throwIfAborted();
		const cached = this.cache.get(domain.name);
		if (cached) {
			const now = Date.now();
			if (
				now - cached.ledgerCloseTime * 1000 < SUCCESS_TTL_MS &&
				(cached.status !== 'resolved' || cached.record.expiresAt * 1000 > now)
			)
				return cached;
			this.cache.delete(domain.name);
		}
		let running = this.pending.get(domain.name);
		if (!running) {
			if (this.pending.size >= MAX_IN_FLIGHT) throw new SorobanDomainBusy();
			const controller = new AbortController();
			const deadline = setTimeout(() => controller.abort(), this.timeoutMs);
			const promise = this.read(domain, controller.signal).finally(() => {
				clearTimeout(deadline);
				this.pending.delete(domain.name);
			});
			running = { controller, promise, admitted: 0, active: 0 };
			this.pending.set(domain.name, running);
		}
		return this.waitForLookup(running, signal);
	}

	private async waitForLookup(
		lookup: PendingLookup,
		signal?: AbortSignal
	): Promise<SorobanDomainLookup> {
		// Cap total subscriptions to this promise, including callers that disconnect.
		if (
			lookup.admitted >= MAX_WAITERS_PER_NAME ||
			lookup.controller.signal.aborted
		)
			throw new SorobanDomainBusy();
		lookup.admitted++;
		lookup.active++;
		let onAbort: (() => void) | undefined;
		try {
			return await new Promise((resolve, reject) => {
				onAbort = () => reject(signal?.reason);
				signal?.addEventListener('abort', onAbort, { once: true });
				void lookup.promise.then(resolve, reject);
			});
		} finally {
			if (onAbort) signal?.removeEventListener('abort', onAbort);
			if (--lookup.active === 0) lookup.controller.abort();
		}
	}

	private async read(
		domain: ExactDomainName,
		signal: AbortSignal
	): Promise<SorobanDomainLookup> {
		const network = await this.request(signal, 'getNetwork');
		if (network.passphrase !== Networks.PUBLIC)
			throw new Error('Registry RPC network mismatch');

		const transaction = new TransactionBuilder(
			new Account(SIMULATION_ACCOUNT, '0'),
			{
				networkPassphrase: Networks.PUBLIC,
				fee: '0'
			}
		)
			.setTimeout(0)
			.addOperation(
				new Contract(REGISTRY_V2).call('record', registryRecordKey(domain))
			)
			.build()
			.toXDR();
		const simulation = await this.request(signal, 'simulateTransaction', {
			transaction
		});
		const ledger = simulation.latestLedger;
		if (
			typeof ledger !== 'number' ||
			!Number.isSafeInteger(ledger) ||
			ledger < 1 ||
			simulation.restorePreamble !== undefined
		)
			throw new Error('Registry simulation unavailable');

		let record: SorobanDomainRecord | undefined;
		let negative: 'not_found' | 'expired' = 'expired';
		if (
			typeof simulation.error === 'string' &&
			simulation.results === undefined
		) {
			// Match the host error itself, never numbers in diagnostics or backtraces.
			const code =
				/^(?:host invocation failed\r?\n\r?\nCaused by:\r?\n[ \t]+HostError: )?Error\(Contract, #(307|308)\)(?:\r?\n|$)/.exec(
					simulation.error
				)?.[1];
			if (!code) throw new Error('Unrecognized registry simulation failure');
			negative = code === '307' ? 'not_found' : 'expired';
		} else {
			const results: unknown = simulation.results;
			if (
				simulation.error !== undefined ||
				!Array.isArray(results) ||
				results.length !== 1
			)
				throw new Error('Invalid registry simulation results');
			const encoded = object(results[0]).xdr;
			if (typeof encoded !== 'string' || encoded.length > 4096)
				throw new Error('Invalid registry simulation XDR');
			record = decodeRegistryRecord(
				domain,
				xdr.ScVal.fromXDR(encoded, 'base64')
			);
		}

		const reply = await this.request(signal, 'getLedgers', {
			startLedger: ledger,
			pagination: { limit: 1 }
		});
		const ledgers: unknown = reply.ledgers;
		if (!Array.isArray(ledgers) || ledgers.length !== 1)
			throw new Error('Registry simulation ledger unavailable');
		const observedLedger = object(ledgers[0]);
		const timestamp = observedLedger.ledgerCloseTime;
		const closeTime =
			typeof timestamp === 'string' && /^\d+$/.test(timestamp)
				? Number(timestamp)
				: NaN;
		const now = Date.now();
		const age = now - closeTime * 1000;
		if (
			observedLedger.sequence !== ledger ||
			!Number.isSafeInteger(closeTime) ||
			age >= SUCCESS_TTL_MS ||
			age < -5_000
		)
			throw new Error('Registry simulation ledger time unavailable or stale');

		const observation: Observation = {
			name: domain.name,
			source: 'creit-soroban-domains-v2',
			network: 'mainnet',
			registry: REGISTRY_V2,
			observedLedger: ledger,
			ledgerCloseTime: closeTime,
			observedAt: new Date(now).toISOString()
		};
		const expiresIn = record
			? record.expiresAt * 1000 - Math.max(now, closeTime * 1000)
			: 0;
		const value: SorobanDomainLookup =
			record && expiresIn > 0
				? { ...observation, status: 'resolved', record }
				: { ...observation, status: negative };
		const ttl =
			value.status === 'resolved'
				? Math.min(SUCCESS_TTL_MS, expiresIn)
				: NEGATIVE_TTL_MS;
		this.cache.set(domain.name, value, {
			ttl: Math.min(ttl, SUCCESS_TTL_MS - age)
		});
		return value;
	}

	private async request(
		signal: AbortSignal,
		method: 'getNetwork' | 'simulateTransaction' | 'getLedgers',
		params?: object
	): Promise<Record<string, unknown>> {
		signal.throwIfAborted();
		const value = await fetchRpcJson(
			this.rpc,
			{
				jsonrpc: '2.0',
				id: 1,
				method,
				params
			},
			{ agent: this.agent, signal }
		);
		signal.throwIfAborted();
		const reply = object(value);
		if (reply.jsonrpc !== '2.0' || reply.id !== 1 || reply.error !== undefined)
			throw new Error('Registry RPC request failed');
		return object(reply.result);
	}
}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('Invalid registry RPC response');
	return value as Record<string, unknown>;
}
