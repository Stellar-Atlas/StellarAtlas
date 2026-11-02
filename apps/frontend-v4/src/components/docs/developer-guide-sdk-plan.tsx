import { type DeveloperGuidePage } from './developer-guide-elements';

export const sdkPlanGuide: DeveloperGuidePage = {
	slug: 'sdk-plan',
	title: 'SDK plan (proposed)',
	group: 'Reference',
	description:
		'Review the proposed TypeScript, Rust and Go client design and implementation gates.',
	sections: [
		{
			id: 'planned-scope',
			title: 'A design plan, not a released SDK',
			content: (
				<>
					<p>
						The proposed first targets are TypeScript, Rust and Go. The Q4
						commitment is to a design, examples and development plan; a released
						SDK remains a longer-term H1 2027 target. No installable package is
						announced here.
					</p>
					<p>
						<a href="https://github.com/Stellar-Atlas/StellarAtlas/blob/main/docs/builders-sdk-plan.md">
							Read the SDK design and implementation plan
						</a>{' '}
						for language API sketches, milestones, precision and pagination
						policies, and planned conformance cases.
					</p>
					<p>
						For requests you can use today, open{' '}
						<a href="/docs/graphql">the GraphQL runner</a> or{' '}
						<a href="/docs/assets-and-issuers">the asset guide</a>. The plan
						builds on existing account balances, asset holders and typed
						transaction workflows.
					</p>
				</>
			)
		},
		{
			id: 'contract-boundaries',
			title: 'Preserve the API’s data boundaries',
			content: (
				<>
					<p>
						Planned clients must retain exact identifiers and raw amounts,
						source precision labels, coverage and freshness metadata, and
						route-scoped cursors. They must surface errors and schema
						incompatibilities instead of treating them as empty results.
					</p>
					<p>
						The <a href="/docs/live-updates">WebSocket publication feed</a>{' '}
						remains origin-restricted first-party freshness hints. It does not
						provide a general wallet/asset subscription API or replayable event
						stream.
					</p>
					<p>
						Future multihop pathfinding requires fresh venue state, asset
						identities, fees and precision, with distinct native Stellar and
						Soroban validation. The plan specifies these requirements; it does
						not claim an executable pathfinder.
					</p>
				</>
			)
		}
	]
};
