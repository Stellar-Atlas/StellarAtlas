import { formatInteger } from '../../format/formatters';

export type MobileGraphPanel = 'network' | 'feed' | null;

export function GraphMobileControls({ panel, validators, organizations, ready, onPanelChange, onReset, onZoom }: {
	readonly panel: MobileGraphPanel;
	readonly validators: number;
	readonly organizations: number;
	readonly ready: boolean;
	readonly onPanelChange: (panel: MobileGraphPanel) => void;
	readonly onReset: () => void;
	readonly onZoom: (factor: number) => void;
}): React.JSX.Element {
	return <div className="graph-mobile-controls">
		<div className="graph-mobile-heading"><h1>Network topology</h1>
			<span>{formatInteger(validators)} validators · {formatInteger(organizations)} orgs</span></div>
		<div className="graph-mobile-actions" aria-label="Graph controls">
			<button type="button" aria-expanded={panel === 'network'} aria-controls="graph-network-panel"
				onClick={() => onPanelChange(panel === 'network' ? null : 'network')}>Network &amp; controls</button>
			<button type="button" aria-expanded={panel === 'feed'} aria-controls="graph-live-panel"
				onClick={() => onPanelChange(panel === 'feed' ? null : 'feed')}>Live feed</button>
			<button type="button" aria-label="Zoom in" disabled={!ready} onClick={() => onZoom(.8)}>+</button>
			<button type="button" aria-label="Zoom out" disabled={!ready} onClick={() => onZoom(1.25)}>−</button>
			<button type="button" aria-label="Reset view" title="Reset view" disabled={!ready} onClick={onReset}>↺</button>
		</div>
		<p id="graph-touch-help">Tap a node · drag sideways to rotate · swipe up/down to scroll</p>
	</div>;
}
