'use client';

import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { isClassicAccount } from '@domain/classic-account';
import { startAccountFederationLookup } from './explorer-account-federation-request';
import type {
	FederationNetwork,
	FederationResult
} from './explorer-account-federation-request';

type IndexedObservation = {
	readonly ledger: string;
	readonly closedAt: string;
};

type Props = {
	readonly accountId: string;
	readonly network: FederationNetwork;
	readonly active: boolean;
	readonly indexedObservation?: IndexedObservation;
};

const messages = {
	indexed_evidence_insufficient:
		'There is insufficient recent account metadata to check a federation name. The account may still exist.',
	unsupported: 'Federation lookup is unsupported for this account evidence.',
	not_found: 'The reverse federation provider returned no name.',
	mismatch: 'The federation responses disagreed. No name could be confirmed.',
	malformed: 'The federation provider returned an invalid record.',
	unavailable: 'Federation lookup is currently unavailable.'
};

/** Secondary identity evidence for one focused classic account view. */
export function ExplorerAccountFederation({
	active,
	accountId,
	network,
	indexedObservation
}: Props): React.JSX.Element | null {
	if (!active || !isClassicAccount(accountId)) return null;
	return (
		<FederationView
			key={network + '/' + accountId}
			accountId={accountId}
			network={network}
			indexedObservation={indexedObservation}
		/>
	);
}

function FederationView({
	accountId,
	network,
	indexedObservation
}: Omit<Props, 'active'>): React.JSX.Element {
	const titleId = useId();
	const [result, setResult] = useState<FederationResult | null>(null);
	useEffect(
		() => startAccountFederationLookup(accountId, network, setResult),
		[accountId, network]
	);
	const display = result?.status === 'display_only' ? result : null;
	return (
		<section className="explorer-result-stack" aria-labelledby={titleId}>
			<h2 id={titleId}>Federation name</h2>
			<p
				className={display ? undefined : 'explorer-state neutral'}
				role="status"
			>
				{statusMessage(result)}
			</p>
			{display && (
				<FederationEvidence
					result={display}
					network={network}
					indexedObservation={indexedObservation}
				/>
			)}
		</section>
	);
}

function statusMessage(result: FederationResult | null): ReactNode {
	if (result === null) return 'Checking federation name…';
	if (result.status === 'display_only')
		return 'Display only. Verify the destination separately before sending a payment.';
	if (result.status === 'throttled') {
		if (result.retryAtMs === null) return 'Federation lookup was rate limited.';
		const retryAt = new Date(result.retryAtMs).toISOString();
		return (
			<>
				Federation lookup is rate limited until{' '}
				<time dateTime={retryAt}>
					{retryAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}
				</time>
				.
			</>
		);
	}
	return messages[result.status];
}

function FederationEvidence({
	result,
	network,
	indexedObservation
}: {
	readonly result: Extract<FederationResult, { status: 'display_only' }>;
	readonly network: FederationNetwork;
	readonly indexedObservation?: IndexedObservation;
}): React.JSX.Element {
	const closedAt =
		indexedObservation?.ledger === result.observedLedger &&
		Number.isFinite(Date.parse(indexedObservation.closedAt))
			? indexedObservation.closedAt
			: null;
	return (
		<dl className="explorer-result-grid">
			<EvidenceField label="SEP-2 name">
				<bdi>{result.stellarAddress}</bdi>
			</EvidenceField>
			<EvidenceField
				label={result.memo ? 'Memo (' + result.memo.type + ')' : 'Memo'}
			>
				{result.memo ? (
					<bdi style={{ whiteSpace: 'pre-wrap' }}>{result.memo.value}</bdi>
				) : (
					'None reported'
				)}
			</EvidenceField>
			<EvidenceField label="Network">
				{network === 'mainnet' ? 'Mainnet' : 'Testnet'}
			</EvidenceField>
			<EvidenceField label="Indexed home domain">
				{result.homeDomain}
			</EvidenceField>
			<EvidenceField label="Alias domain">{result.aliasDomain}</EvidenceField>
			<EvidenceField label="Reverse provider">
				{result.reverseProviderOrigin}
			</EvidenceField>
			<EvidenceField label="Forward provider">
				{result.forwardProviderOrigin}
			</EvidenceField>
			<EvidenceField label="Account metadata observation ledger">
				{result.observedLedger}
			</EvidenceField>
			{closedAt && (
				<EvidenceField label="Observation ledger close time">
					<time dateTime={closedAt}>{closedAt}</time>
				</EvidenceField>
			)}
		</dl>
	);
}

function EvidenceField({
	label,
	children
}: {
	readonly label: string;
	readonly children: ReactNode;
}): React.JSX.Element {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}
