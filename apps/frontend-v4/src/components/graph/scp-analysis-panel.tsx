import type { PublicNetwork } from '../../api/types';
import { formatBoolean, formatInteger } from '../../format/formatters';

interface ScpAnalysisPanelProps {
	network: PublicNetwork;
}

interface AnalysisMetric {
	description: string;
	label: string;
	value: string;
}

interface AnalysisStatus {
	description: string;
	label: string;
	tone: 'danger' | 'good';
	value: string;
}

const formatSetSize = (value: number): string =>
	value > 0 ? formatInteger(value) : 'None';

const getAnalysisMetrics = (network: PublicNetwork): AnalysisMetric[] => [
	{
		description:
			'Validators in the network transitive quorum set. These nodes materially participate in the current safety/liveness calculation.',
		label: 'Top tier validators',
		value: formatInteger(network.statistics.topTierSize)
	},
	{
		description:
			'Organizations represented by validators in the transitive quorum set.',
		label: 'Top tier orgs',
		value: formatInteger(network.statistics.topTierOrgsSize)
	},
	{
		description:
			'Smallest filtered validator set that can prevent quorum progress if unavailable.',
		label: 'Blocking set',
		value: formatSetSize(network.statistics.minBlockingSetFilteredSize)
	},
	{
		description:
			'Smallest filtered organization set that can prevent quorum progress if unavailable.',
		label: 'Org blocking set',
		value: formatSetSize(network.statistics.minBlockingSetOrgsFilteredSize)
	},
	{
		description:
			'Smallest validator set that could split network agreement under the current quorum graph.',
		label: 'Splitting set',
		value: formatSetSize(network.statistics.minSplittingSetSize)
	},
	{
		description:
			'Strongly connected components found in the validator trust graph.',
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
	const statuses: AnalysisStatus[] = [
		{
			description:
				'Whether every quorum slice path overlaps enough to preserve network safety.',
			label: 'Quorum intersection',
			tone: quorumIntersectionTone,
			value: formatBoolean(network.statistics.hasQuorumIntersection)
		},
		{
			description:
				'Whether the configured quorum set reaches a stable validator core through transitive trust.',
			label: 'Transitive quorum set',
			tone: transitiveTone,
			value: formatBoolean(network.statistics.hasTransitiveQuorumSet)
		}
	];

	return (
		<section className="scp-analysis-panel" aria-label="SCP analysis">
			<div className="scp-analysis-heading">
				<h2>SCP analysis</h2>
				<span>Ledger {network.latestLedger}</span>
			</div>
			<div className="scp-status-row">
				{statuses.map((status) => (
					<div
						aria-label={`${status.label}: ${status.description}`}
						className={`scp-status ${status.tone} analysis-tooltip`}
						data-tooltip={status.description}
						key={status.label}
						tabIndex={0}
					>
						<span>{status.label}</span>
						<strong>{status.value}</strong>
					</div>
				))}
			</div>
			<div className="scp-metric-grid">
				{getAnalysisMetrics(network).map((metric) => (
					<div
						aria-label={`${metric.label}: ${metric.description}`}
						className="analysis-tooltip"
						data-tooltip={metric.description}
						key={metric.label}
						tabIndex={0}
					>
						<span>{metric.label}</span>
						<strong>{metric.value}</strong>
					</div>
				))}
			</div>
		</section>
	);
}
