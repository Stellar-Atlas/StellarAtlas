'use client';

import { useEffect, useRef, useState } from 'react';
import type {
	PublicExplorerAccount,
	PublicExplorerAsset,
	PublicExplorerAssets,
	PublicExplorerContract,
	PublicExplorerLedger,
	PublicExplorerOperation,
	PublicRecentTransactions,
	PublicTransactionLookup
} from '@api/types';
import type {
	ExplorerAssetsResult,
	ExplorerContractResult,
	ExplorerOperationsResult,
	ExplorerSearchResult,
	ExplorerTransactionsResult
} from '../../app/actions/network-data';

export function SearchResultView({
	result
}: {
	readonly result: ExplorerSearchResult;
}): React.JSX.Element | null {
	if (result.message)
		return <ExplorerState tone="warning" text={result.message} />;
	if (!result.search) return null;
	if (!result.search.result) {
		return (
			<ExplorerState
				tone="warning"
				text={`No ${result.search.resultType} result`}
			/>
		);
	}
	if (isLedger(result.search.result))
		return <LedgerCard ledger={result.search.result} />;
	if (isAccount(result.search.result))
		return <AccountCard account={result.search.result} />;
	if (isAssets(result.search.result))
		return <AssetsTable assets={result.search.result.assets} />;
	if (isContract(result.search.result))
		return <ContractCard contract={result.search.result} />;
	if (isTransaction(result.search.result))
		return <TransactionCard transaction={result.search.result} />;
	return <OperationTable operations={[result.search.result]} />;
}

export function OperationsView({
	result
}: {
	readonly result: ExplorerOperationsResult;
}): React.JSX.Element | null {
	if (result.message)
		return <ExplorerState tone="warning" text={result.message} />;
	if (!result.operations) return null;
	return (
		<>
			{result.operations.truncated ? (
				<ExplorerState
					tone="neutral"
					text="Result set is capped. Narrow the filters for a smaller result set."
				/>
			) : null}
			<OperationTable operations={result.operations.records} />
		</>
	);
}

export function AssetsView({
	result
}: {
	readonly result: ExplorerAssetsResult;
}): React.JSX.Element | null {
	if (result.message)
		return <ExplorerState tone="warning" text={result.message} />;
	if (!result.assets) return null;
	return <AssetsTable assets={result.assets.assets} />;
}

export function ContractView({
	result
}: {
	readonly result: ExplorerContractResult;
}): React.JSX.Element | null {
	if (result.message)
		return <ExplorerState tone="warning" text={result.message} />;
	return result.contract ? <ContractCard contract={result.contract} /> : null;
}

export function RecentTransactionsView({
	onInspect,
	result
}: {
	readonly onInspect: (hash: string) => void;
	readonly result: ExplorerTransactionsResult;
}): React.JSX.Element | null {
	if (result.message)
		return <ExplorerState tone="warning" text={result.message} />;
	if (!result.transactions)
		return <ExplorerState tone="neutral" text="Loading recent transactions." />;

	return (
		<div className="explorer-transaction-feed">
			<ExplorerState
				tone="neutral"
				text={`${formatExplorerSource(result.transactions.source)} transaction sample updated ${formatDate(result.transactions.generatedAt)}.`}
			/>
			{result.transactions.truncated ? (
				<ExplorerState
					tone="neutral"
					text={`Showing ${result.transactions.records.length} external fallback rows from the current response window.`}
				/>
			) : null}
			<TransactionFeedRows
				onInspect={onInspect}
				transactions={result.transactions}
			/>
		</div>
	);
}

function formatExplorerSource(source: PublicRecentTransactions['source']): string {
	if (source === 'horizon') return 'External fallback';
	return source;
}

export function toDateInputValue(value: string | undefined): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toISOString().slice(0, 16);
}

function TransactionFeedRows({
	onInspect,
	transactions
}: {
	readonly onInspect: (hash: string) => void;
	readonly transactions: PublicRecentTransactions;
}): React.JSX.Element {
	const [expandedHash, setExpandedHash] = useState<string | null>(null);
	const [copiedHash, setCopiedHash] = useState<string | null>(null);
	const copyResetTimer = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (copyResetTimer.current !== null) {
				window.clearTimeout(copyResetTimer.current);
			}
		};
	}, []);

	if (transactions.records.length === 0)
		return <ExplorerState tone="neutral" text="No transactions returned." />;

	const copyHash = (hash: string): void => {
		void writeClipboardText(hash)
			.then(() => {
				setCopiedHash(hash);
				if (copyResetTimer.current !== null) {
					window.clearTimeout(copyResetTimer.current);
				}
				copyResetTimer.current = window.setTimeout(() => {
					setCopiedHash(null);
					copyResetTimer.current = null;
				}, 1600);
			})
			.catch(() => setCopiedHash(null));
	};

	return (
		<div className="explorer-table transaction-feed">
			{transactions.records.slice(0, transactions.limit).map((transaction) => {
				const expanded = expandedHash === transaction.hash;
				const copied = copiedHash === transaction.hash;
				const hashDetailsId = `transaction-hash-${transaction.hash}`;

				return (
					<div className="explorer-transaction-row" key={transaction.hash}>
						<div className="transaction-hash-cell">
							<strong
								aria-label={`Transaction hash ${transaction.hash}`}
								className="transaction-hash-short"
								title={transaction.hash}
							>
								{formatTransactionHash(transaction.hash)}
							</strong>
							<button
								aria-label={`Copy transaction hash ${transaction.hash}`}
								className="hash-action"
								onClick={() => copyHash(transaction.hash)}
								type="button"
							>
								{copied ? 'Copied' : 'Copy'}
							</button>
							<button
								aria-controls={hashDetailsId}
								aria-expanded={expanded}
								aria-label={`${expanded ? 'Collapse' : 'Expand'} transaction hash ${transaction.hash}`}
								className="hash-action"
								onClick={() =>
									setExpandedHash(expanded ? null : transaction.hash)
								}
								type="button"
							>
								{expanded ? 'Hide' : 'Full'}
							</button>
							{expanded ? (
								<code className="transaction-hash-full" id={hashDetailsId}>
									{transaction.hash}
								</code>
							) : null}
						</div>
						<span>{formatDate(transaction.createdAt)}</span>
						<span>ledger {transaction.ledger}</span>
						<span>{transaction.operationCount} ops</span>
						<span>{transaction.successful ? 'successful' : 'failed'}</span>
						<button
							aria-label={`Inspect transaction ${transaction.hash}`}
							className="inspect-action"
							onClick={() => onInspect(transaction.hash)}
							type="button"
						>
							Inspect
						</button>
					</div>
				);
			})}
		</div>
	);
}

function LedgerCard({
	ledger
}: {
	readonly ledger: PublicExplorerLedger;
}): React.JSX.Element {
	return (
		<dl className="explorer-result-grid">
			<ResultItem label="Ledger" value={ledger.sequence} />
			<ResultItem label="Closed" value={formatDate(ledger.closedAt)} />
			<ResultItem label="Operations" value={ledger.operationCount.toString()} />
			<ResultItem
				label="Transactions"
				value={ledger.transactionCount?.toString() ?? 'Unavailable'}
			/>
			<ResultItem label="Protocol" value={ledger.protocolVersion.toString()} />
			<ResultItem label="Hash" value={ledger.hash} />
		</dl>
	);
}

function AccountCard({
	account
}: {
	readonly account: PublicExplorerAccount;
}): React.JSX.Element {
	return (
		<div className="explorer-result-stack">
			<dl className="explorer-result-grid">
				<ResultItem label="Account" value={account.accountId} />
				<ResultItem label="Sequence" value={account.sequence} />
				<ResultItem
					label="Subentries"
					value={account.subentryCount.toString()}
				/>
				<ResultItem
					label="Last ledger"
					value={account.lastModifiedLedger ?? 'Unknown'}
				/>
			</dl>
			<AssetsTable assets={account.balances.map(mapBalanceAsset)} />
		</div>
	);
}

function ContractCard({
	contract
}: {
	readonly contract: PublicExplorerContract;
}): React.JSX.Element {
	return (
		<dl className="explorer-result-grid">
			<ResultItem label="Contract" value={contract.contractId} />
			<ResultItem label="Readiness" value={formatContractReadiness(contract)} />
			<ResultItem label="Source" value={contract.source} />
			<ResultItem label="Probe" value={contract.probe.replace('_', ' ')} />
			<ResultItem label="Message" value={contract.message} />
		</dl>
	);
}

function TransactionCard({
	transaction
}: {
	readonly transaction: PublicTransactionLookup;
}): React.JSX.Element {
	return (
		<dl className="explorer-result-grid">
			<ResultItem label="Transaction" value={transaction.hash} />
			<ResultItem label="Ledger" value={transaction.ledger} />
			<ResultItem label="Created" value={formatDate(transaction.createdAt)} />
			<ResultItem label="Source account" value={transaction.sourceAccount} />
			<ResultItem label="Data source" value={formatExplorerSource(transaction.source)} />
			<ResultItem
				label="Operations"
				value={transaction.operationCount.toString()}
			/>
			<ResultItem label="Fee" value={transaction.feeCharged} />
			<ResultItem
				label="Status"
				value={transaction.successful ? 'Successful' : 'Failed'}
			/>
		</dl>
	);
}

function OperationTable({
	operations
}: {
	readonly operations: readonly PublicExplorerOperation[];
}): React.JSX.Element {
	if (operations.length === 0)
		return <ExplorerState tone="neutral" text="No operations returned." />;
	return (
		<div className="explorer-table">
			{operations.slice(0, 50).map((operation) => (
				<div className="explorer-table-row" key={operation.id}>
					<strong>{operation.type}</strong>
					<span>{formatDate(operation.createdAt)}</span>
					<span>{operation.ledger ?? 'ledger unknown'}</span>
					<span>{operation.sourceAccount ?? 'source unknown'}</span>
					<span>{operation.transactionHash ?? 'transaction unknown'}</span>
				</div>
			))}
		</div>
	);
}

function AssetsTable({
	assets
}: {
	readonly assets: readonly PublicExplorerAsset[];
}): React.JSX.Element {
	if (assets.length === 0)
		return <ExplorerState tone="neutral" text="No assets returned." />;
	return (
		<div className="explorer-table assets">
			{assets.slice(0, 50).map((asset, index) => (
				<div
					className="explorer-table-row"
					key={`${asset.assetType}:${asset.assetCode}:${asset.assetIssuer}:${index}`}
				>
					<strong>{asset.assetCode ?? asset.assetType}</strong>
					<span>{asset.assetIssuer ?? 'native'}</span>
					<span>{asset.numAccounts?.toString() ?? 'accounts unknown'}</span>
					<span>{asset.amount ?? 'amount unknown'}</span>
				</div>
			))}
		</div>
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

function ExplorerState({
	text,
	tone
}: {
	readonly text: string;
	readonly tone: 'neutral' | 'warning';
}): React.JSX.Element {
	return <p className={`explorer-state ${tone}`}>{text}</p>;
}

function isLedger(value: unknown): value is PublicExplorerLedger {
	return (
		isRecord(value) && 'operationCount' in value && 'protocolVersion' in value
	);
}

function isAccount(value: unknown): value is PublicExplorerAccount {
	return isRecord(value) && 'balances' in value && 'subentryCount' in value;
}

function isAssets(value: unknown): value is PublicExplorerAssets {
	return isRecord(value) && 'assets' in value;
}

function isContract(value: unknown): value is PublicExplorerContract {
	return isRecord(value) && 'contractId' in value && 'status' in value;
}

function isTransaction(value: unknown): value is PublicTransactionLookup {
	return isRecord(value) && 'feeCharged' in value && 'hash' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function mapBalanceAsset(
	balance: PublicExplorerAccount['balances'][number]
): PublicExplorerAsset {
	return {
		amount: balance.balance,
		assetCode: balance.assetCode,
		assetIssuer: balance.assetIssuer,
		assetType: balance.assetType,
		numAccounts: null,
		source: 'horizon'
	};
}

function formatDate(value: string): string {
	if (value.length === 0) return 'Unknown';
	return new Date(value).toLocaleString();
}

function formatTransactionHash(hash: string): string {
	if (hash.length <= 24) return hash;
	return `${hash.slice(0, 12)}...${hash.slice(-10)}`;
}

function formatContractReadiness(contract: PublicExplorerContract): string {
	if (contract.readiness === 'planned') return 'Planned';
	if (contract.readiness === 'configured_not_probed') return 'Not probed';
	return contract.status;
}

async function writeClipboardText(value: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}

	const field = document.createElement('textarea');
	field.value = value;
	field.setAttribute('readonly', 'true');
	field.style.position = 'fixed';
	field.style.inset = '0';
	field.style.opacity = '0';
	document.body.append(field);
	field.select();
	document.execCommand('copy');
	field.remove();
}
