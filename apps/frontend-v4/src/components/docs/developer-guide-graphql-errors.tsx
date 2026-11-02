import { Code, type DeveloperGuideSection } from './developer-guide-elements';
import { graphqlErrorExample } from './graphql-error-example';

export const graphqlErrorSection: DeveloperGuideSection = {
	id: 'handle-errors',
	title: 'Handle incomplete or unavailable results',
	content: (
		<>
			<p>
				Correct invalid REST inputs on HTTP 400. Some typed explorer detail
				routes distinguish a missing record in a completed window (404) from a
				record not found in an incompletely ingested window (409). Other route
				families have their own documented error shapes.
			</p>
			<p>
				For GraphQL, inspect the JSON <code>errors</code> array and HTTP status
				together. HTTP 200 can contain a failed request, including validation or
				warehouse errors. An error has a message; <code>extensions.code</code>{' '}
				is optional. A missing code is not a reason to retry.
			</p>
			<table>
				<thead>
					<tr>
						<th>Response requested with Accept</th>
						<th>Tested error responses</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>application/json</code>
						</td>
						<td>
							HTTP 200 for tested syntax, schema, variable, resolver and
							request-budget errors.
						</td>
					</tr>
					<tr>
						<td>
							<code>application/graphql-response+json</code>
						</td>
						<td>
							HTTP 400 for tested syntax, schema and budget errors; HTTP 200 for
							variable and resolver errors.
						</td>
					</tr>
					<tr>
						<td>
							Unsupported type such as <code>text/plain</code>
						</td>
						<td>HTTP 406 in the tested case.</td>
					</tr>
				</tbody>
			</table>
			<p>
				Both JSON response types can carry errors at HTTP 200. Read error bodies
				at HTTP 400 too; do not discard their messages by throwing on status
				first. Some HTTP failures have an empty or non-JSON body. These tested
				outcomes do not assign a status to every possible failure.
			</p>
			<p>
				Run this JavaScript in a modern browser console or Node ES module. It
				reuses the runner’s payment-operations request and makes one attempt
				with a ten-second deadline, without automatic retries. Replace its
				historical window using your coverage response.
			</p>
			<Code language="javascript">{graphqlErrorExample}</Code>
			<p>
				The example outputs the original response text, preserving numeric
				strings and literals without reserializing them through JavaScript
				numbers. Keep exact identifiers and raw amounts as strings. Use a
				lossless decoder before calculating with large numeric literals in
				untyped details; source Float64 observations remain approximate.
			</p>
			<p>
				Errors with partial data are separate from a complete page. Keep an
				earlier successful page visible and do not advance pagination from an
				error response. A failed fetch has no HTTP response to inspect; a local
				deadline does not prove that server work stopped.
			</p>
			<p>
				For idempotent reads, a deliberately bounded retry policy can handle
				known transient failures such as <code>SERVICE_UNAVAILABLE</code>, HTTP
				503 or a lost connection. Cap attempts and total elapsed time, use
				backoff with jitter, and honor <code>Retry-After</code> when supplied.
				Correct syntax, schema, variable and <code>BAD_USER_INPUT</code> errors
				first. Split or narrow <code>QUERY_TOO_COMPLEX</code> requests instead
				of retrying unchanged. When the cause is unclear, surface the error
				rather than assuming it is transient.
			</p>
		</>
	)
};
