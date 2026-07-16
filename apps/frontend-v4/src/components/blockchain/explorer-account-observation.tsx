import type { PublicExplorerLocalAccountChanges } from '@api/types';
import { formatDate } from './blockchain-explorer-format';

type AvailableAccountChanges = Extract<
	PublicExplorerLocalAccountChanges,
	{ readonly status: 'available' }
>;
type AccountObservation = AvailableAccountChanges['records'][number];
type AccountCoverage = AvailableAccountChanges['coverage'];

export function ExplorerAccountObservation({
	account
}: {
	readonly account: PublicExplorerLocalAccountChanges;
}): React.JSX.Element {
	switch (account.status) {
		case 'unavailable':
			return (
				<p className="explorer-state warning">
					No complete proof-gated coverage is available for account changes, so
					no historical observation can be reported.
				</p>
			);
		case 'not_observed':
			return (
				<div className="explorer-result-stack">
					<p className="explorer-state neutral">
						No account change observed in covered ledgers{' '}
						{account.coverage.range.firstLedger} to{' '}
						{account.coverage.range.lastLedger}. This does not prove the account
						was absent; it only means no account change was indexed in that
						covered interval.
					</p>
					<CoverageGrid
						accountId={account.accountId}
						coverage={account.coverage}
					/>
				</div>
			);
		case 'available':
			return <AvailableObservation changes={account} />;
		default:
			return assertNever(account);
	}
}

function AvailableObservation({
	changes
}: {
	readonly changes: AvailableAccountChanges;
}): React.JSX.Element {
	const observation = changes.records[0];
	if (observation === undefined) {
		return (
			<p className="explorer-state warning">
				Proof-gated account changes were marked available, but no historical
				observation was returned.
			</p>
		);
	}

	return (
		<div className="explorer-result-stack">
			<p className="explorer-state neutral">
				Newest proof-gated historical account observation. Values were observed
				at ledger {observation.position.ledgerSequence}; newer changes may
				exist.
			</p>
			<dl className="explorer-result-grid">
				<ResultItem
					label="Account"
					value={observation.accountFields.accountId}
				/>
				<ResultItem
					label="Native balance at observation"
					value={`${observation.accountFields.balance} stroops`}
				/>
				<ResultItem
					label="Sequence at observation"
					value={observation.accountFields.sequenceNumber}
				/>
				<ResultItem
					label="Subentries at observation"
					value={observation.accountFields.subentryCount}
				/>
				<ResultItem
					label="Signer count at observation"
					value={observation.accountFields.signers.length.toString()}
				/>
				<ResultItem
					label="Observed ledger"
					value={observation.position.ledgerSequence}
				/>
				<ResultItem
					label="Observed time"
					value={formatDate(observation.freshness.ledgerClosedAt)}
				/>
				<ResultItem
					label="Covered ledger range"
					value={formatCoverageRange(changes.coverage)}
				/>
				<ResultItem
					label="Coverage through"
					value={formatDate(
						changes.coverage.freshness.latestCoveredLedgerClosedAt
					)}
				/>
				<ResultItem
					label="Coverage completed"
					value={formatDate(
						changes.coverage.freshness.canonicalCoverageCompletedAt
					)}
				/>
				<ResultItem label="Deletion" value={formatDeletion(observation)} />
				<ResultItem
					label="State semantics"
					value={formatStateSemantics(observation)}
				/>
				<ResultItem
					label="Proof version"
					value={`Minimum v${observation.provenance.proof.minimumVersion}`}
				/>
				<ResultItem
					label="Observation batch"
					value={observation.provenance.batch.id}
				/>
			</dl>
		</div>
	);
}

function CoverageGrid({
	accountId,
	coverage
}: {
	readonly accountId: string;
	readonly coverage: AccountCoverage;
}): React.JSX.Element {
	return (
		<dl className="explorer-result-grid">
			<ResultItem label="Account" value={accountId} />
			<ResultItem
				label="Covered ledger range"
				value={formatCoverageRange(coverage)}
			/>
			<ResultItem
				label="Coverage through"
				value={formatDate(coverage.freshness.latestCoveredLedgerClosedAt)}
			/>
			<ResultItem
				label="Coverage completed"
				value={formatDate(coverage.freshness.canonicalCoverageCompletedAt)}
			/>
			<ResultItem
				label="Coverage proof evaluated"
				value={formatDate(coverage.freshness.canonicalProofEvaluatedAt)}
			/>
			<ResultItem label="Coverage batch" value={coverage.range.batchId} />
		</dl>
	);
}

function ResultItem({
	label,
	value
}: {
	readonly label: string;
	readonly value: string;
}): React.JSX.Element {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

function formatCoverageRange(coverage: AccountCoverage): string {
	return `${coverage.range.firstLedger} to ${coverage.range.lastLedger} (${coverage.range.ledgerCount.toLocaleString()} ledgers)`;
}

function formatDeletion(observation: AccountObservation): string {
	return observation.deleted
		? 'Deleted in this observed change'
		: 'Not deleted in this observed change';
}

function formatStateSemantics(observation: AccountObservation): string {
	return observation.stateSemantics === 'final_pre_deletion_state'
		? 'Final pre-deletion state'
		: 'Observed post-change state';
}

function assertNever(value: never): never {
	throw new TypeError(
		`Unsupported account observation status: ${String(value)}`
	);
}
