import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';
import { graphqlExamples } from './graphql-request';
import { balanceObservationPath } from '../../api/explorer-balance-observations';

const kale = graphqlExamples.holders.variables.asset;
const wallet = graphqlExamples.balances.variables.account;
const walletPath = balanceObservationPath('balances', wallet, null);
const holderPath = balanceObservationPath('holders', kale, null, {
	sort: graphqlExamples.holders.variables.input.sort,
	order: graphqlExamples.holders.variables.input.order
});

export const assetsAndIssuersGuide: DeveloperGuidePage = {
	slug: 'assets-and-issuers',
	title: 'Assets, balances and issuers',
	group: 'Querying data',
	description:
		'Find an asset, read wallet balances and holders, and interpret issuer metadata.',
	sections: [
		{
			id: 'wallet-and-holders',
			title: 'Quickstart: find KALE, read balances and holders',
			content: (
				<>
					<p>
						These read-only examples use the same asset and sample wallet as the
						GraphQL runner. Replace the wallet with your own public G-address;
						no private key or wallet signature is needed.
					</p>
					<ol>
						<li>
							<p>Find the asset and confirm its issuer.</p>
							<Code>{`curl --fail-with-body '${api}/v1/assets?symbol=${encodeURIComponent(kale.split(':')[0]!)}&limit=10'`}</Code>
							<p>
								Read <code>data[].id</code> and <code>issuer</code>; a ticker
								can match multiple assets. This walkthrough uses{' '}
								<code>{kale}</code>. If discovery has another page, pass its{' '}
								<code>nextCursor</code>{' '}
								as <code>cursor</code> with the same symbol and limit.
							</p>
						</li>
						<li>
							<p>Read one page of the wallet’s balance observations.</p>
							<Code>{`curl --fail-with-body '${api}${walletPath}' --output wallet-balances.json`}</Code>
							<p>
								Inspect <code>balances</code>, matching <code>asset</code> to
								the full KALE identity. The sample wallet is independent of the
								asset search; this example does not promise it holds KALE. A
								balance may be on a later page. See the{' '}
								<a href="/docs/api/listAnalyticsAccountBalances">
									balances reference
								</a>
								.
							</p>
						</li>
						<li>
							<p>Read KALE holders, largest observed balance first.</p>
							<Code>{`curl --fail-with-body '${api}${holderPath}' --output kale-holders.json`}</Code>
							<p>
								Read <code>holders</code> as this page’s positive-balance
								observations. Its length is not the total holder count; inspect{' '}
								<code>indexedSummary</code> and{' '}
								<code>watermark.indexStatus</code>{' '}
								before using an indexed summary. See the{' '}
								<a href="/docs/api/listAnalyticsAssetHoldersResource">
									holders reference
								</a>
								.
							</p>
						</li>
					</ol>
					<p>
						Continue each result with its own <code>nextCursor</code> as{' '}
						<code>after</code>. With <code>jq</code> installed, these commands
						request the second pages only when a cursor exists:
					</p>
					<Code>{`after=$(jq -er '.nextCursor // empty' wallet-balances.json) &&
curl --fail-with-body --get '${api}${walletPath}' \\
  --data-urlencode "after=$after"

after=$(jq -er '.nextCursor // empty' kale-holders.json) &&
curl --fail-with-body --get '${api}${holderPath}' \\
  --data-urlencode "after=$after"`}</Code>
					<p>
						Keep the same account or asset, limit, sort and order. Stop on{' '}
						<code>nextCursor: null</code>; never exchange discovery, balance and
						holder cursors. These are latest-ingested observations, not
						current-chain balances or a frozen snapshot. Amounts retain source
						Float64 precision. Check{' '}
						<code>coverage</code>, <code>watermark</code> and precision fields;
						an empty page alone does not prove a wallet never held an asset. See{' '}
						<a href="/docs/querying">pagination and error handling</a>.
					</p>
					<p>
						For GraphQL, open the <a href="/docs/graphql">runner</a> and choose{' '}
						<strong>{graphqlExamples.balances.label}</strong> or{' '}
						<strong>{graphqlExamples.holders.label}</strong>. Set your account
						or asset in Variables, execute, then put that result’s cursor in
						<code>input.after</code> without changing its other inputs. The
						presets use their own page sizes; the REST examples above use 25.
						See <a href="/docs/graphql-guide">the GraphQL request format</a>.
					</p>
					<p>
						For freshness, <a href="/docs/live-updates">WebSocket updates</a>{' '}
						are origin-restricted first-party publication hints. They do not
						stream wallet balances or accept asset/account subscriptions;
						third-party clients should repeat bounded reads at an appropriate
						interval and handle failures with backoff.
					</p>
				</>
			)
		},
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
						<a href="/docs/api">Endpoint directory</a>
					</p>
				</>
			)
		}
	]
};
