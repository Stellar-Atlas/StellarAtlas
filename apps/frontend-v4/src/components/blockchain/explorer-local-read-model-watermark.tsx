import type { ExplorerLocalReadModelResult } from '../../app/actions/network-data';

export function ExplorerLocalReadModelWatermark({
	result
}: {
	readonly result: ExplorerLocalReadModelResult;
}): React.JSX.Element {
	if (result.status === 'invalid') return <WatermarkSkeleton />;
	if (result.status === 'unavailable' || result.readModel === null) {
		return (
			<p className="explorer-local-watermark warning">
				{result.message ?? 'Explorer local read model unavailable'}
			</p>
		);
	}

	const headers = result.readModel.parsedLedgerHeaders;
	return (
		<div className="explorer-local-watermark">
			<div>
				<strong>Local parsed headers</strong>
				<span>
					{formatLedger(headers.earliestParsedLedger)} to{' '}
					{formatLedger(headers.latestParsedLedger)}
				</span>
			</div>
			<div>
				<strong>{headers.parsedLedgerCount.toLocaleString()}</strong>
				<span>headers from {headers.sourceArchiveCount} archive sources</span>
			</div>
			<div>
				<strong>Transactions</strong>
				<span>External fallback active; local transaction index pending</span>
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
