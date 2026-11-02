import {
	api,
	Code,
	type DeveloperGuideSection
} from './developer-guide-elements';
import { graphqlExamples } from './graphql-request';
import excerpts from './transaction-guide-excerpts.json' with { type: 'json' };

const request = `curl --fail-with-body --connect-timeout 5 --max-time 30 --get '${api}/v1/analytics/transactions/'"$hash" \\
  --data-urlencode 'view=typed' \\
  --data-urlencode "ledger_sequence=$ledger" \\
  --data-urlencode "limit=$limit"`;

function continuation(relation: 'operations' | 'effects' | 'events'): string {
	return `after=$(jq -er '.${relation}.nextCursor // empty' transaction-page-1.json) &&
${request} \\
  --data-urlencode "${relation}_after=$after" \\
  --output transaction-${relation}-page-2.json`;
}

export const transactionGuideCommands = {
	first: `hash=$(jq -er '.rows[0].transactionHash // empty' operations-page-1.json) &&
ledger=$(jq -er '.rows[0].ledgerSequence // empty' operations-page-1.json) &&
limit=1 &&
${request} \\
  --output transaction-page-1.json`,
	operations: continuation('operations'),
	effects: continuation('effects'),
	events: continuation('events')
};

export const transactionRelationsSection: DeveloperGuideSection = {
	id: 'transaction-relations',
	title: 'Inspect a transaction and continue its related records',
	content: (
		<>
			<p>
				Start with an operation you selected in the{' '}
				<a href="/docs/quickstart#fetch-operations">Quickstart</a>, then open
				the{' '}
				<a href="/docs/api/getAnalyticsTransaction">
					typed transaction endpoint
				</a>
				. This shell example requires jq and a successful{' '}
				<code>operations-page-1.json</code>. It selects the first row’s hash and
				known ledger; choose a different row before starting if needed. An empty
				operations page makes jq stop without requesting a transaction. No
				sample hash below is promised to exist in production.
			</p>
			<Code>{transactionGuideCommands.first}</Code>
			<p>
				Keep the hash, known ledger and limit unchanged in this shell session.
				Each request permits five seconds to connect and thirty seconds total,
				without automatic retries. Continue only after a successful response;
				timeout or HTTP failure can leave an incomplete file and does not prove
				that the transaction never existed or that server work stopped.
			</p>
			<p>
				Read <code>transaction</code> separately from the three relation
				envelopes: <code>operations</code>, <code>effects</code> and{' '}
				<code>events</code>. Each has its own <code>items</code>,{' '}
				<code>limit</code> and <code>nextCursor</code>. A short relation page is
				not the transaction’s total operation or event count. This excerpt
				selects fields from an offline synthetic first-page fixture; other
				fields and cursor values are omitted. It is not a live record:
			</p>
			<Code language="json">{JSON.stringify(excerpts.first, null, 2)}</Code>
			<p>
				Preserve IDs, sequence numbers and raw amounts as strings. For example,{' '}
				<code>9007199254740993</code> cannot pass through JavaScript Number
				unchanged. Use an amount’s returned <code>raw</code>,{' '}
				<code>decimal</code>,<code>scale</code> and <code>source</code>{' '}
				together; do not infer another asset’s precision from this example. Keep
				untyped <code>detailsJson</code>
				intact until you use a lossless decoder.
			</p>
			<p>
				Choose one of these second-page reads. Each takes only its matching
				token from the saved first response; it does not advance the other two
				relations. Omitting their cursor inputs returns their initial pages
				again, so consume only the intended relation from each new file. There
				is no automatic all-pages loop.
			</p>
			<Code>{transactionGuideCommands.operations}</Code>
			<Code>{transactionGuideCommands.effects}</Code>
			<Code>{transactionGuideCommands.events}</Code>
			<p>
				If that relation’s <code>nextCursor</code> is null, jq stops without an
				HTTP request. For another page, use the matching relation’s cursor from
				its most recent successful response. Null means no continuation for that
				relation in the observed result; it is not proof of complete chain
				history. Check the response’s <code>coverage</code> and{' '}
				<code>observedAt</code> with the{' '}
				<a href="/docs/querying">coverage and pagination rules</a>.
			</p>
			<p>
				Copy tokens unchanged, without decoding them. Do not exchange relation
				tokens or carry them to another transaction, ledger or page size. The
				reviewed synthetic wrong-relation fixture returns HTTP 400 with this
				body; correct the input instead of retrying it unchanged:
			</p>
			<Code language="json">
				{JSON.stringify(excerpts.wrongRelation.body, null, 2)}
			</Code>
			<p>
				For GraphQL, open the <a href="/docs/graphql">runner</a> and choose{' '}
				<strong>{graphqlExamples.transaction.label}</strong>. Set your
				transaction hash, known ledger and limit, then use{' '}
				<code>operationsAfter</code>, <code>effectsAfter</code> or{' '}
				<code>eventsAfter</code> with its own result cursor. See{' '}
				<a href="/docs/graphql-guide">the request format</a> and{' '}
				<a href="/docs/querying#handle-errors">GraphQL error handling</a>.
			</p>
		</>
	)
};
