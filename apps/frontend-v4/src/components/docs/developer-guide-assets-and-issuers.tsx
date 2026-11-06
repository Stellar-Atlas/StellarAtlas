import { api, Code, type DeveloperGuidePage } from './developer-guide-elements';
import { graphqlExamples } from './graphql-request';
import { balanceObservationPath } from '../../api/explorer-balance-observations';
import { saveRestPage } from './save-rest-page-example';

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
								<code>nextCursor</code> as <code>cursor</code> with the same
								symbol and limit.
							</p>
						</li>
						<li>
							<p>Read one page of the wallet’s balance observations.</p>
							<Code>{saveRestPage(walletPath, 'wallet-balances.json')}</Code>
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
							<Code>{saveRestPage(holderPath, 'kale-holders.json')}</Code>
							<p>
								Read <code>holders</code> as this page’s positive-balance
								observations. Its length is not the total holder count; inspect{' '}
								<code>indexedSummary</code> and{' '}
								<code>watermark.indexStatus</code> before using an indexed
								summary. See the{' '}
								<a href="/docs/api/listAnalyticsAssetHoldersResource">
									holders reference
								</a>
								.
							</p>
						</li>
					</ol>
					<p>
						These Bash examples use curl 7.84 or newer, <code>mktemp</code> and
						GNU <code>mv</code>.
						Each invocation creates its own temporary beside the saved page,
						promotes only a successful response without a fallback marker and cleans up its own
						temporary on exit. The parentheses scope variables and traps to that
						invocation. An HTTP or transport failure means the refresh is
						unavailable, not an empty balance or holder result. Stop this
						walkthrough on failure and do not continue pagination. If you retain
						the last successful response, label it as saved data rather than a
						fresh read. Its <code>watermark.catalogGeneratedAt</code> is the
						catalogue generation time, not the time you saved the response or a
						pinned balance snapshot.
					</p>
					<p>
						After saving a first page successfully, use its <code>nextCursor</code>{' '}
						as <code>after</code>. With <code>jq</code> installed, run the matching
						command to save a separate second page. A missing, null or unusable
						cursor stops the command before it sends a request.
					</p>
					<Code>{saveRestPage(walletPath, 'wallet-balances-next.json', 'wallet-balances.json')}</Code>
					<Code>{saveRestPage(holderPath, 'kale-holders-next.json', 'kale-holders.json')}</Code>
					<p>
						Keep the same account or asset, limit, sort and order. Stop on{' '}
						<code>nextCursor: null</code>; never exchange discovery, balance and
						holder cursors. These are latest-ingested observations, not
						current-chain balances or a frozen snapshot. Amounts retain source
						Float64 precision. The files preserve the original JSON bytes.
						Keep raw integer strings as strings to avoid rounding. Check each
						page’s <code>coverage</code>, <code>watermark</code> and precision
						fields. Treat findings as partial when the response reports coverage
						gaps or when more pages remain. An empty page alone
						does not prove a wallet never held an asset. See{' '}
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
			id: 'account-balance-breakdown',
			title: 'Understand current account balances',
			content: (
				<>
					<p>
						The current account view reads classic balances from the configured
						Horizon provider. Its ledger can lag the network tip. The indexed
						balances in the quickstart above come from imported observations
						with separate coverage and precision. If the current provider fails,
						keep those observations labelled separately. A failed read or an
						unavailable amount is different from a reported zero.
					</p>
					<Code>{`curl -q --fail-with-body --connect-timeout 5 --max-time 70 '${api}/v1/explorer/accounts/${wallet}'`}</Code>
					<p>
						See the <a href="/docs/api/getExplorerAccount">account API reference</a>.
						Bind the response to the requested account and network. Use{' '}
						<code>accounting.latestLedger</code> and, when available,{' '}
						<code>accounting.ledgerClosedAt</code> for the provider snapshot.{' '}
						<code>lastModifiedLedger</code> describes the account’s last change.
						If the provider snapshot ledger is unavailable, leave freshness
						unconfirmed. Keep <code>balances[].exact.balanceRaw</code> and raw
						liability amounts as integer strings at scale seven, or use exact
						integer arithmetic. Treat null fields as missing evidence. The{' '}
						<code>balanceInventoryComplete</code> flag applies to the classic
						balance inventory and can be true while optional liability or
						authorization fields are missing.
					</p>
					<ul>
						<li>
							<strong>Offer commitments.</strong> Selling liabilities report the
							amount required for open sell offers. For a fully authorized
							issued-asset trustline, subtract those commitments from the balance
							to calculate availability. Buying liabilities reserve capacity to
							receive the asset and do not reduce the held balance.
						</li>
						<li>
							<strong>Native reserve.</strong> For XLM, also subtract the minimum
							reserve. Calculate it as{' '}
							<code>base reserve × (2 + subentries + sponsoring − sponsored)</code>.
							Use <code>accounting.baseReserveRaw</code> only when{' '}
							<code>accounting.baseReserveLedger</code> matches the snapshot
							ledger and all counts are available. For example, 10 XLM with 1.25
							XLM committed to selling and a 3 XLM reserve leaves 5.75 XLM before
							fees. The required amount is 4.25 XLM. With only 1 XLM held,
							1 XLM covers part of the minimum reserve first. The reserve
							shortfall is 2 XLM and the sell-offer shortfall is 1.25 XLM.
							Availability in that case is zero. If reserve evidence is missing,
							the reported selling liability can still be shown. Leave the
							combined required and covered amounts, offer allocation and
							availability uncalculated.
						</li>
						<li>
							<strong>Receive headroom.</strong> For a fully authorized issued
							trustline, subtract the balance and buying liabilities from the
							trustline limit. A zero-balance trustline can still have receive
							headroom. Keep authorization restrictions visible, including
							authorization only to maintain liabilities. A restricted or unknown
							amount is different from an exact zero on an authorized trustline.
						</li>
					</ul>
					<p>
						Claimable balances and contract funds are separate positions.
						Display them only with their own evidence. The principal in a
						claimable balance has already left the source balance, and reserve
						sponsorship is already included in the account counts. Avoid
						deducting either twice. A classic balance shown through a Stellar
						Asset Contract is the same holding. For classic liquidity-pool shares,
						show the exact share balance. Sell-offer reservations do not apply,
						and share count alone does not establish a withdrawable amount.
						The account’s reserve calculation already uses the protocol’s
						weighted counts.
					</p>
					<p>
						Where a protocol position is supported by a retained observation,
						show it separately with its ledger and close time. Even a recent
						observation describes that ledger. Keep it out of current balance
						and availability totals. Missing evidence does not establish a
						zero position or complete account coverage.
					</p>
					<p>
						Cached logos and collectible labels come from issuer metadata
						matched to the full asset identity. Use <code>cacheOnly=true</code>{' '}
						on the asset metadata batch route for an already-cached lookup that
						does not queue a refresh. An uncached logo can appear as a monogram.
						A collectible link or NFT-backing declaration is a
						publisher claim. Trustline evidence shows the quantity held, while
						scarcity and backing remain unverified. A federation name is
						display-only. Keep the full G-address primary and verify payment
						details separately.
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
