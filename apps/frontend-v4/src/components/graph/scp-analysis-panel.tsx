import type { PublicNetwork } from '../../api/types';
import { formatBoolean, formatInteger } from '../../format/formatters';

interface ScpAnalysisPanelProps {
	network: PublicNetwork;
}

interface AnalysisMetric {
	label: string;
	value: string;
}

const formatSetSize = (value: number): string =>
	value > 0 ? formatInteger(value) : 'None';

const getAnalysisMetrics = (network: PublicNetwork): AnalysisMetric[] => [
	{
		label: 'Top tier validators',
		value: formatInteger(network.statistics.topTierSize)
	},
	{
		label: 'Top tier orgs',
		value: formatInteger(network.statistics.topTierOrgsSize)
	},
	{
		label: 'Blocking set',
		value: formatSetSize(network.statistics.minBlockingSetFilteredSize)
	},
	{
		label: 'Org blocking set',
		value: formatSetSize(network.statistics.minBlockingSetOrgsFilteredSize)
	},
	{
		label: 'Splitting set',
		value: formatSetSize(network.statistics.minSplittingSetSize)
	},
	{
		label: 'Components',
		value: formatInteger(network.scc.length)
	}
];

export function ScpAnalysisPanel({
	network
}: ScpAnalysisPanelProps): React.JSX.Element {
	const quorumIntersectionTone = network.statistics.hasQuorumIntersection
		? 'good'
		: 'danger';
	const transitiveTone = network.statistics.hasTransitiveQuorumSet
		? 'good'
		: 'danger';

	return (
		<section className="scp-analysis-panel" aria-label="SCP analysis">
			<div className="scp-analysis-heading">
				<h2>SCP analysis</h2>
				<span>Ledger {network.latestLedger}</span>
			</div>
			<div className="scp-status-row">
				<div className={`scp-status ${quorumIntersectionTone}`}>
					<span>Quorum intersection</span>
					<strong>
						{formatBoolean(network.statistics.hasQuorumIntersection)}
					</strong>
				</div>
				<div className={`scp-status ${transitiveTone}`}>
					<span>Transitive quorum set</span>
					<strong>
						{formatBoolean(network.statistics.hasTransitiveQuorumSet)}
					</strong>
				</div>
			</div>
			<div className="scp-metric-grid">
				{getAnalysisMetrics(network).map((metric) => (
					<div key={metric.label}>
						<span>{metric.label}</span>
						<strong>{metric.value}</strong>
					</div>
				))}
			</div>
		</section>
	);
}
