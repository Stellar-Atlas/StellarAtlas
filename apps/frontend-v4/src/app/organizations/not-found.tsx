import { RouteNotFoundPanel } from '@components/layout/route-fallbacks';

export default function OrganizationsNotFound(): React.JSX.Element {
	return (
		<RouteNotFoundPanel
			description="The requested organization is not present in the current public network snapshot."
			href="/organizations"
			linkLabel="View organizations"
			title="Organization not found"
		/>
	);
}
