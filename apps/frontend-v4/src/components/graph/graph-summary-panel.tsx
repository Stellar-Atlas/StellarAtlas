import type { PublicNetwork } from '../../api/types';
import { formatInteger } from '../../format/formatters';
import { getNodeLabel } from '../../domain/network';
import type {
	Graph3DModel,
	Graph3DNode,
	Graph3DOrganization
} from './model-3d';
import { ScpAnalysisPanel } from './scp-analysis-panel';

interface GraphSummaryPanelProps {
	activeOrganization: Graph3DOrganization | null;
	animationsEnabled: boolean;
	liveNetwork: PublicNetwork;
	model: Graph3DModel;
	onFocusOrganization: (organization: Graph3DOrganization) => void;
	onHoverOrganizationChange: (organization: Graph3DOrganization | null) => void;
	onToggleAnimations: () => void;
	onToggleConnectable: () => void;
	selectedNode: Graph3DNode | null;
	showAllConnectable: boolean;
}

export function GraphSummaryPanel({
	activeOrganization,
	animationsEnabled,
	liveNetwork,
	model,
	onFocusOrganization,
	onHoverOrganizationChange,
	onToggleAnimations,
	onToggleConnectable,
	selectedNode,
	showAllConnectable
}: GraphSummaryPanelProps): React.JSX.Element {
	return (
		<section className="graph-overlay graph-summary">
			<p className="eyebrow">{liveNetwork.name}</p>
			<h1>Network topology</h1>
			<div className="summary-grid">
				<strong>
					{formatInteger(liveNetwork.statistics.nrOfConnectableNodes)}
				</strong>
				<span>connectable</span>
				<strong>
					{formatInteger(liveNetwork.statistics.nrOfActiveValidators)}
				</strong>
				<span>validators</span>
				<strong>{formatInteger(liveNetwork.organizations.length)}</strong>
				<span>organizations</span>
			</div>
			<button
				className={showAllConnectable ? 'graph-toggle active' : 'graph-toggle'}
				onClick={onToggleConnectable}
				type="button"
			>
				{showAllConnectable ? 'Validator topology' : 'All connectable nodes'}
			</button>
			<button
				aria-label={
					animationsEnabled ? 'Pause SCP animation' : 'Resume SCP animation'
				}
				aria-pressed={animationsEnabled}
				className={
					animationsEnabled ? 'animation-toggle active' : 'animation-toggle'
				}
				onClick={onToggleAnimations}
				type="button"
			>
				{animationsEnabled ? 'Pause SCP animation' : 'Resume SCP animation'}
			</button>
			<ScpAnalysisPanel network={liveNetwork} />
			<div className="organization-rail">
				<h2>Organizations</h2>
				{activeOrganization && (
					<div className="selected-organization-card">
						<span style={{ backgroundColor: activeOrganization.color }} />
						<div>
							<strong>{activeOrganization.name}</strong>
							<small>
								{activeOrganization.validatorCount} validators /{' '}
								{activeOrganization.nodeCount} nodes
								{activeOrganization.inTransitiveQuorumSet ? ' / top tier' : ''}
							</small>
							{selectedNode &&
								selectedNode.groupId === activeOrganization.id && (
									<em>Selected: {getNodeLabel(selectedNode.node)}</em>
								)}
						</div>
					</div>
				)}
				<div className="organization-list">
					{model.organizations.map((organization) => (
						<button
							className={
								activeOrganization?.id === organization.id ? 'active' : ''
							}
							key={organization.id}
							onClick={() => onFocusOrganization(organization)}
							onMouseEnter={() => onHoverOrganizationChange(organization)}
							onMouseLeave={() => onHoverOrganizationChange(null)}
							type="button"
						>
							<span style={{ backgroundColor: organization.color }} />
							<strong>{organization.name}</strong>
							<small>
								{organization.validatorCount} validators /{' '}
								{organization.nodeCount} nodes
								{organization.inTransitiveQuorumSet ? ' / top tier' : ''}
							</small>
						</button>
					))}
				</div>
			</div>
		</section>
	);
}
