import type { ExplorerLocalReadModelResult } from '../../app/actions/network-data';
import type { PublicExplorerLocalReadModel } from '../../api/explorer-types';
import { formatCanonicalEvidenceSelection } from '../canonical-history-copy';

export function ExplorerLocalReadModelWatermark({
	result
}: {
	readonly result: ExplorerLocalReadModelResult;
}): React.JSX.Element {
	if (result.status === 'invalid') return <WatermarkSkeleton />;
	if (result.status === 'unavailable' || result.readModel === null) {
		return (
			<p className="explorer-local-watermark warning">
				{result.message ?? 'Explorer status unavailable'}
			</p>
		);
	}

	const headers = result.readModel.parsedLedgerHeaders;
	const indexes = result.readModel.indexes;
	const canonical = result.readModel.transactions.canonicalCoverage;
	return (
		<div className="explorer-local-watermark">
			<div>
				<strong>
					{canonical === null
						? 'Sparse parsed-header watermark'
						: 'Canonical transaction range'}
				</strong>
				<span>
					{formatLedger(canonical?.firstLedger ?? headers.earliestParsedLedger)}{' '}
					to {formatLedger(canonical?.lastLedger ?? headers.latestParsedLedger)}
				</span>
			</div>
			<div>
				<strong>
					{(
						canonical?.ledgerCount ?? headers.parsedLedgerCount
					).toLocaleString()}
				</strong>
				<span>
					{canonical === null
						? `parsed headers observed across ${headers.sourceArchiveCount} archive roots`
						: formatCanonicalEvidenceSelection(canonical.archiveSourceCount)}
				</span>
			</div>
			<div>
				<strong>Local decoded indexes</strong>
				<span>{formatDecodedIndexCoverage(indexes)}</span>
			</div>
			<div>
				<strong>Transaction source</strong>
				<span>
					{formatTransactionSource(result.readModel.transactions.source)}
				</span>
			</div>
		</div>
	);
}

function WatermarkSkeleton(): React.JSX.Element {
	return (
		<p className="explorer-local-watermark neutral">
			Loading local parsed-header watermark
		</p>
	);
}

function formatLedger(value: string | null): string {
	return value === null ? 'none' : `ledger ${Number(value).toLocaleString()}`;
}

function formatDecodedIndexCoverage(
	indexes: PublicExplorerLocalReadModel['indexes']
): string {
	const ready = [
		indexes.transactionIndexReady ? 'transactions' : null,
		indexes.operationIndexReady ? 'operations' : null,
		indexes.assetIndexReady ? 'assets' : null,
		indexes.contractIndexReady ? 'contracts' : null
	].filter((label): label is string => label !== null);

	if (ready.length === 0) {
		return 'transaction, operation, asset, and contract indexes are not available yet';
	}

	return ready.join(', ') + ' active';
}

function formatTransactionSource(
	source: PublicExplorerLocalReadModel['transactions']['source']
): string {
	if (source === 'horizon_fallback') return 'Stellar public API';
	return 'StellarAtlas canonical history';
}
