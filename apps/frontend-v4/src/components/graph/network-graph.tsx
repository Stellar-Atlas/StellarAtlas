import type { PublicNetwork } from '../../api/types';
import { buildGraphModel } from './model';
import { NetworkGraphCanvas } from './network-graph-canvas';

interface NetworkGraphProps {
	network: PublicNetwork;
}

export function NetworkGraph({ network }: NetworkGraphProps): React.JSX.Element {
	return <NetworkGraphCanvas model={buildGraphModel(network)} />;
}
