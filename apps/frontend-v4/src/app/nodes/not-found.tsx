import { RouteNotFoundPanel } from '@components/layout/route-fallbacks';

export default function NodesNotFound(): React.JSX.Element {
	return (
		<RouteNotFoundPanel
			description="The requested node is not present in the current public network snapshot."
			href="/nodes"
			linkLabel="View nodes"
			title="Node not found"
		/>
	);
}
