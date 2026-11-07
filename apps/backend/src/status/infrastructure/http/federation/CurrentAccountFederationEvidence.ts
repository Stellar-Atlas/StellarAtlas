import type { ExplorerAccountDTO } from '../../../../network-scan/infrastructure/http/ExplorerAccountClient.js';
import type { createExplorerAccountProvider } from '../../../../network-scan/infrastructure/http/ExplorerAccountProvider.js';
import {
	parseHorizonTimestamp,
	parseLatestLedger,
	uint32
} from '../../../../network-scan/infrastructure/http/HorizonAccountFields.js';
import { normalizeIssuerDomain } from '../issuer-domains/IssuerDomainCache.js';

export interface CurrentFederationSource {
	readonly provider: ReturnType<typeof createExplorerAccountProvider>;
	readonly networkPassphrase: string;
}
type Eligibility =
	| {
			readonly status: 'eligible';
			readonly homeDomain: string;
			readonly observedLedger: string;
	  }
	| { readonly status: 'unsupported' | 'indexed_evidence_insufficient' };

/** Fresh ledger metadata can establish a discovery domain without warehouse history. */
export function currentFederationEvidence(
	accountId: string,
	account: ExplorerAccountDTO | null,
	source: CurrentFederationSource,
	now: number
): Eligibility {
	if (account === null) return { status: 'unsupported' };
	const snapshot = account.accounting;
	const recent = (timestamp: unknown, maxAge: number): boolean => {
		if (parseHorizonTimestamp(timestamp) === null) return false;
		const age = now - Date.parse(String(timestamp));
		return age >= 0 && age <= maxAge;
	};
	const modified =
		account.lastModifiedLedger === null
			? null
			: uint32(Number(account.lastModifiedLedger));
	if (
		account.source !== 'horizon' ||
		account.accountId !== accountId ||
		account.provider?.mode !== 'operator_alternate' ||
		account.provider.hostname !== source.provider.provider.hostname ||
		!recent(account.provider.observedAt, 30_000) ||
		!snapshot ||
		snapshot.snapshotStatus !== 'ledger_bound' ||
		snapshot.networkPassphrase !== source.networkPassphrase ||
		!recent(snapshot.ledgerClosedAt, 15 * 60_000) ||
		(account.lastModifiedLedger !== null && modified === null)
	)
		return { status: 'indexed_evidence_insufficient' };
	const ledger = parseLatestLedger(snapshot.latestLedger, modified);
	if (!ledger || account.homeDomain === undefined)
		return { status: 'indexed_evidence_insufficient' };
	if (account.homeDomain === null) return { status: 'unsupported' };
	const homeDomain = normalizeIssuerDomain(account.homeDomain);
	return homeDomain
		? { status: 'eligible', homeDomain, observedLedger: ledger }
		: { status: 'indexed_evidence_insufficient' };
}
