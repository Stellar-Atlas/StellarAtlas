import {
	api,
	Code,
	type DeveloperGuideSection
} from './developer-guide-elements';
import fixtures from './public-health-fixtures.json' with { type: 'json' };

export const publicHealthRequests = {
	health: `curl --fail-with-body --connect-timeout 5 --max-time 10 \\
  --write-out 'HTTP %{http_code}\\n' \\
  '${api}/v1/public-goods/health' --output health.json`,
	metrics: `curl --fail-with-body --connect-timeout 5 --max-time 10 \\
  --write-out 'HTTP %{http_code}\\n' \\
  '${api}/v1/public-goods/metrics' --output metrics.json`
};

function responseExample(path: string): string {
	const fixture = fixtures.find(
		(value) => value.scenario === 'stale-incomplete' && value.path === path
	);
	if (!fixture) throw new Error('Missing public API example');
	return JSON.stringify(fixture.body, null, 2);
}

export const publicHealthMetricsSection: DeveloperGuideSection = {
	id: 'public-health-metrics',
	title: 'Check service readiness and interpret measured counts',
	content: (
		<>
			<p>
				Use the <a href="/docs/api/getPublicGoodsHealth">health endpoint</a> for
				combined service readiness and the{' '}
				<a href="/docs/api/getPublicGoodsMetrics">metrics endpoint</a> for
				measured publication and archive counts. These observations do not
				establish complete chain history or replace a query’s{' '}
				<a href="/docs/querying">coverage checks</a>.
			</p>
			<Code>{publicHealthRequests.health}</Code>
			<Code>{publicHealthRequests.metrics}</Code>
			<p>
				Each command limits connection time to five seconds and total time to
				ten seconds, without automatic retries. It prints the HTTP status
				separately and saves the JSON body. On HTTP 503, curl reports failure
				but still saves the response body: inspect it to learn which checks or
				sources failed. A local timeout can leave an incomplete file; it does
				not prove data absence or that server work stopped.
			</p>
			<p>
				Health returns HTTP 200 with <code>status: ready</code> only when its
				ClickHouse, publication and archive checks pass. HTTP 503 with{' '}
				<code>status: not_ready</code> can report <code>stale</code>,{' '}
				<code>empty</code>, <code>incomplete</code> or <code>unavailable</code>{' '}
				evidence. Read each check’s status and observation time. This combines
				service signals; it does not say every dataset window or archive history
				is complete.
			</p>
			<p>
				Metrics returns HTTP 200 when both metric sources were read, even when
				health is not ready. A required metric source failure returns HTTP 503
				with unavailable values left <code>null</code>. Keep null distinct from
				zero and inspect observation times; an HTTP 200 metrics response is not
				a readiness certificate. These observations are not intended to be
				cached as a permanent success.
			</p>
			<p>
				These synthetic examples illustrate the same stale publication and
				incomplete archive inventory. They are not a live status report. The
				health example is HTTP 503:
			</p>
			<Code language="json">{responseExample('/v1/public-goods/health')}</Code>
			<p>
				The metrics example is HTTP 200, with unknown counts retained as null:
			</p>
			<Code language="json">{responseExample('/v1/public-goods/metrics')}</Code>
			<table>
				<thead>
					<tr>
						<th>Field</th>
						<th>Meaning and limit</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>publication.records</code>
						</td>
						<td>
							Projected rows recorded by completed ingestion manifests, not
							unique transactions, unique ledgers or physical database rows.
						</td>
					</tr>
					<tr>
						<td>
							<code>publication.publishedDatasets</code>
						</td>
						<td>
							Configured datasets with nonzero measured active rows, not
							datasets with complete historical coverage.
						</td>
					</tr>
					<tr>
						<td>
							<code>archives.checkedRoots</code>
						</td>
						<td>
							Sources observed within the reported window, including failed
							observations, not fully verified archive histories.
						</td>
					</tr>
					<tr>
						<td>
							<code>archives.rootObjectsVerified</code>
						</td>
						<td>
							Verified root-state objects, not verification of every checkpoint
							or all historical data.
						</td>
					</tr>
					<tr>
						<td>
							<code>archives.complete</code>
						</td>
						<td>
							Whether the source inventory used for these counts is complete and
							untruncated, not whether chain history is complete.
						</td>
					</tr>
				</tbody>
			</table>
			<p>
				Keep decimal strings such as <code>records</code>, batch counts and{' '}
				<code>maximumLedger</code> as strings; JavaScript Number can round large
				values. The example’s <code>9007199254740993</code> is illustrative and
				exact. Converting to Number or treating null as zero changes the
				evidence.
			</p>
		</>
	)
};
