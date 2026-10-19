import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';

export const assetsAndIssuersGuide: DeveloperGuidePage = {
	slug: 'assets-and-issuers',
	title: 'Assets and issuers',
	group: 'Querying data',
	description:
		'Find assets by identity, ledger or time, and interpret issuer metadata.',
	sections: [
		{
			id: 'asset-identifiers',
			title: 'Use an asset identity, not a ticker alone',
			content: (
				<>
					<p>
						An issued asset is identified by both its code and G-address issuer.
						The canonical form is <code>CODE:GISSUER</code>; the reversed
						<code>GISSUER:CODE</code> form and compatibility{' '}
						<code>CODE_GISSUER</code>
						and <code>GISSUER_CODE</code> forms resolve to the same identity.
						Use
						<code>native</code>, <code>XLM</code>, <code>-</code> or{' '}
						<code>_</code> for the native asset. URL-encode the colon in a path.
					</p>
					<p>
						A symbol is not unique: searching issued asset code <code>XLM</code>
						returns all matching issuers; the API does not pick one. Resolve
						C-address assets through the SAC reverse registry. An unmapped
						C-address remains an unclassified contract, not proof of a SEP-41
						token.
					</p>
					<p>
						Circle USDC is{' '}
						<code>
							USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
						</code>
						; its SAC is{' '}
						<code>
							CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
						</code>
						.
					</p>
				</>
			)
		},
		{
			id: 'asset-discovery',
			title: 'Search the published asset catalogue',
			content: (
				<>
					<Code>{`curl --fail-with-body "${api}/v1/assets?q=USDC&limit=20"`}</Code>
					<p>
						The compact catalogue is built from published history, not a default
						recent 64-ledger window. Results report first and last observed
						ledgers; these are observations, not an asset's creation ledger or
						proof of complete network history.
					</p>
					<p>
						Ledger and close-time bounds are explicit filters, separate from
						text search:
					</p>
					<Code>{`curl --fail-with-body "${api}/v1/assets?min_ledger=60000000&max_ledger=61000000&limit=20"`}</Code>
					<Code>{`curl --fail-with-body "${api}/v1/assets?start_time=2025-01-01T00%3A00%3A00Z&end_time=2025-02-01T00%3A00%3A00Z&limit=20"`}</Code>
					<p>
						Continue with the returned opaque <code>cursor</code> and same
						filters and <code>limit</code>; do not treat the cursor as an asset
						ID.
					</p>
				</>
			)
		},
		{
			id: 'asset-details',
			title: 'Open an asset or issuer',
			content: (
				<>
					<Code>{`curl --fail-with-body "${api}/v1/assets/USDC%3AGA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"`}</Code>
					<Code>{`curl --fail-with-body "${api}/v1/assets/USDC%3AGA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/metadata"`}</Code>
					<Code>{`curl --fail-with-body '${api}/v1/issuers/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
curl --fail-with-body '${api}/v1/issuers/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN/assets?limit=20'`}</Code>
					<p>
						Issuer metadata comes from its home domain's Stellar TOML. Asset
						metadata status is <code>pending</code> (bounded refresh queued),
						<code>ready</code> (available), or <code>unavailable</code> (could
						not be obtained). Logos are cached and served by StellarAtlas.
						Pending or unavailable does not prove that the asset does not exist.
					</p>
					<p>
						Preserve attribution: show the issuer home domain and TOML/source
						link with issuer-supplied names, URLs and images. This is
						issuer-published metadata, not independently verified claims.
					</p>
					<p>
						Next: <a href="/docs/querying">Filtering and pagination</a> ·{' '}
						<a href="/docs/api">Asset API directory</a>
					</p>
				</>
			)
		}
	]
};
