import type {
	PublicExplorerAccount,
	PublicExplorerAsset,
	PublicExplorerAssets,
	PublicExplorerContract,
	PublicExplorerLedger,
	PublicExplorerOperation,
	PublicTransactionLookup
} from '@api/types';
import type {
	ExplorerAssetsResult,
	ExplorerContractResult,
	ExplorerOperationsResult,
	ExplorerSearchResult
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
					text="Result set is capped to the fetched Horizon window."
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

export function toDateInputValue(value: string | undefined): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toISOString().slice(0, 16);
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
			<ResultItem label="Status" value={contract.status} />
			<ResultItem label="Source" value={contract.source} />
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
			<ResultItem label="Source" value={transaction.sourceAccount} />
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
