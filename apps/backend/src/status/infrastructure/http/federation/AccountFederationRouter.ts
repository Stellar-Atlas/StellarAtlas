import { Networks, StrKey } from '@stellar/stellar-sdk';
import express, { type Response, type Router } from 'express';
import { setTimeout } from 'node:timers/promises';
import type { GetExplorerLocalAccountChanges } from '../../../../network-scan/use-cases/get-explorer-local-account-changes/GetExplorerLocalAccountChanges.js';
import { ScheduledFederationProviderBudget } from './FederationProviderBudget.js';
import {
	ReverseFederationResolver,
	type ReverseFederationResult
} from './ReverseFederationResolver.js';
import {
	requireFederationScheduleDirectory,
	SharedFederationScheduleStore,
	syncFederationDirectory
} from './SharedFederationScheduleStore.js';

const maxPending = 8;
const maxObservationAgeMs = 15 * 60_000;
const drainTimeoutMs = 10_000;
const route = '/accounts/:accountId/federation';

type ReadAccount = GetExplorerLocalAccountChanges['execute'];
type Network = 'mainnet' | 'testnet';
type Lookup = ReverseFederationResolver['resolve'];
type AccountFederationResult =
	| { readonly status: 'indexed_evidence_insufficient' }
	| Exclude<ReverseFederationResult, { status: 'display_only' }>
	| (Extract<ReverseFederationResult, { status: 'display_only' }> & {
			readonly observedLedger: string;
	  });

/** Extends in-flight deduplication to the local account-index read. */
export class AccountFederationService {
	private closing = false;
	private readonly pending = new Map<
		string,
		Promise<AccountFederationResult>
	>();

	constructor(
		private readonly readAccount: ReadAccount,
		private readonly lookup: Lookup,
		private readonly drainSchedule: () => Promise<void>,
		private readonly now: () => number = Date.now
	) {}

	resolve(accountId: string): Promise<AccountFederationResult> {
		if (this.closing) return Promise.resolve({ status: 'temporary_failure' });
		const active = this.pending.get(accountId);
		if (active) return active;
		if (this.pending.size >= maxPending)
			return Promise.resolve({ status: 'temporary_failure' });
		const operation = this.resolveIndexed(accountId).finally(() =>
			this.pending.delete(accountId)
		);
		this.pending.set(accountId, operation);
		return operation;
	}

	async drain(timeoutMs = drainTimeoutMs): Promise<boolean> {
		this.closing = true;
		const timer = new AbortController();
		const complete = Promise.all(this.pending.values())
			.then(() => this.drainSchedule())
			.then(
				() => true,
				() => false
			);
		try {
			return await Promise.race([
				complete,
				setTimeout(timeoutMs, false, { signal: timer.signal })
			]);
		} finally {
			timer.abort();
		}
	}

	private async resolveIndexed(
		accountId: string
	): Promise<AccountFederationResult> {
		try {
			const indexed = await this.readAccount({ accountId, limit: 1 });
			if (this.closing) return { status: 'temporary_failure' };
			if (indexed.status === 'unavailable')
				return { status: 'temporary_failure' };
			if (indexed.status !== 'available')
				return { status: 'indexed_evidence_insufficient' };
			const record = indexed.records[0];
			const coverage = indexed.coverage;
			if (
				indexed.accountId !== accountId ||
				!record ||
				!coverage ||
				record.accountFields.accountId !== accountId ||
				record.coverage.batchId !== coverage.range.batchId ||
				!this.recent(record.freshness.ledgerClosedAt) ||
				!this.recent(coverage.freshness.latestCoveredLedgerClosedAt)
			)
				return { status: 'indexed_evidence_insufficient' };
			if (record.deleted || !record.accountFields.homeDomain)
				return { status: 'unsupported' };
			const result = await this.lookup(
				accountId,
				record.accountFields.homeDomain
			);
			if (result.status !== 'display_only') return result;
			if (result.accountId !== accountId) return { status: 'mismatch' };
			return { ...result, observedLedger: record.position.ledgerSequence };
		} catch {
			return { status: 'temporary_failure' };
		}
	}

	private recent(timestamp: string): boolean {
		const age = this.now() - Date.parse(timestamp);
		return age >= 0 && age <= maxObservationAgeMs;
	}
}

export async function createAccountFederation(
	schedulePath: string | undefined,
	passphrase: string,
	readAccount: ReadAccount
): Promise<{ router: Router; drain: () => Promise<boolean> }> {
	const network =
		passphrase === Networks.PUBLIC
			? 'mainnet'
			: passphrase === Networks.TESTNET
				? 'testnet'
				: null;
	let service: AccountFederationService | null = null;
	if (schedulePath && network) {
		const directory = await requireFederationScheduleDirectory(schedulePath);
		await syncFederationDirectory(directory).catch(() => {
			throw new Error('Federation scheduler requires directory sync support');
		});
		const store = new SharedFederationScheduleStore(directory);
		const resolver = new ReverseFederationResolver(
			new ScheduledFederationProviderBudget(store),
			undefined,
			passphrase
		);
		service = new AccountFederationService(
			readAccount,
			(accountId, domain) => resolver.resolve(accountId, domain),
			() => store.drain()
		);
	}
	return {
		router: accountFederationRouter(network, service),
		drain: async () => (await service?.drain()) ?? true
	};
}

export function accountFederationRouter(
	network: Network | null,
	service: AccountFederationService | null
): Router {
	const router = express.Router();
	router.head(route, (_request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Allow', 'GET');
		response.status(405).end();
	});
	router.get(route, async (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		const { accountId } = request.params;
		if (
			!accountId ||
			accountId.length !== 56 ||
			!StrKey.isValidEd25519PublicKey(accountId) ||
			Object.keys(request.query).length
		) {
			sendJson(response, 400, { error: 'invalid_account_or_query' });
			return;
		}
		const result = (await service?.resolve(accountId)) ?? {
			status: 'temporary_failure' as const
		};
		const identity = { accountId, network, status: result.status };
		if (result.status === 'throttled') {
			response.setHeader(
				'Retry-After',
				String(Math.max(1, Math.ceil((result.retryAtMs - Date.now()) / 1000)))
			);
			sendJson(response, 429, { ...identity, retryAtMs: result.retryAtMs });
			return;
		}
		if (result.status === 'temporary_failure') {
			sendJson(response, 503, identity);
			return;
		}
		if (result.status === 'display_only') {
			sendJson(response, 200, {
				...identity,
				stellarAddress: result.stellarAddress,
				memo: result.memo && {
					type: result.memo.type,
					value: result.memo.value
				},
				homeDomain: result.homeDomain,
				aliasDomain: result.aliasDomain,
				reverseProviderOrigin: result.reverseProviderOrigin,
				forwardProviderOrigin: result.forwardProviderOrigin,
				observedLedger: result.observedLedger
			});
			return;
		}
		sendJson(response, 200, identity);
	});
	return router;
}

function sendJson(response: Response, status: number, body: object): void {
	// A transient alias should not have an Express-generated cache validator.
	response.status(status).type('application/json').end(JSON.stringify(body));
}
