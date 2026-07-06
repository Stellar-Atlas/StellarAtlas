import type { PublicHistoryArchiveScan } from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';

type HistoryArchiveMetadata = NonNullable<
	PublicHistoryArchiveScan['archiveMetadata']
>;
type HistoryStateBucket =
	HistoryArchiveMetadata['stellarHistory']['currentBuckets'][number];

export function HistoryArchiveStateDocument({
	archiveMetadata
}: {
	readonly archiveMetadata: HistoryArchiveMetadata | null;
}): React.JSX.Element | null {
	if (archiveMetadata === null) return null;

	const state = archiveMetadata.stellarHistory;
	const hotArchiveBuckets = state.hotArchiveBuckets ?? [];

	return (
		<details className="metadata-document history-archive-state" open>
			<summary>
				<span>History archive state</span>
				<a
					href={archiveMetadata.stellarHistoryUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					{archiveMetadata.stellarHistoryUrl}
				</a>
			</summary>
			<p className="muted-copy">
				Scanner-captured `stellar-history.json` parsed{' '}
				{formatDateTime(archiveMetadata.observedAt)}.
			</p>
			<dl className="details">
				<div>
					<dt>Version</dt>
					<dd>{formatInteger(state.version)}</dd>
				</div>
				<div>
					<dt>Server</dt>
					<dd>{state.server}</dd>
				</div>
				<div>
					<dt>Current ledger</dt>
					<dd>{formatInteger(state.currentLedger)}</dd>
				</div>
				<div>
					<dt>Network</dt>
					<dd>{state.networkPassphrase ?? 'Not declared'}</dd>
				</div>
				<div>
					<dt>Current buckets</dt>
					<dd>{formatInteger(state.currentBuckets.length)}</dd>
				</div>
				<div>
					<dt>Hot archive buckets</dt>
					<dd>{formatInteger(hotArchiveBuckets.length)}</dd>
				</div>
			</dl>
			<BucketList label="Current bucket list" buckets={state.currentBuckets} />
			{hotArchiveBuckets.length > 0 ? (
				<BucketList label="Hot archive bucket list" buckets={hotArchiveBuckets} />
			) : null}
			<details className="metadata-document nested-metadata-document">
				<summary>
					<span>Raw captured JSON</span>
				</summary>
				<pre>{JSON.stringify(state, null, 2)}</pre>
			</details>
		</details>
	);
}

function BucketList({
	buckets,
	label
}: {
	readonly buckets: readonly HistoryStateBucket[];
	readonly label: string;
}): React.JSX.Element {
	return (
		<div className="history-state-bucket-section">
			<h4>{label}</h4>
			{buckets.length === 0 ? (
				<p className="muted-copy">No bucket hashes are declared.</p>
			) : (
				<ol className="history-state-buckets">
					{buckets.map((bucket, index) => (
						<li key={`${bucket.curr}:${bucket.snap}:${index}`}>
							<dl>
								<div>
									<dt>Current</dt>
									<dd>{bucket.curr}</dd>
								</div>
								<div>
									<dt>Snapshot</dt>
									<dd>{bucket.snap}</dd>
								</div>
								<div>
									<dt>Next state</dt>
									<dd>{formatInteger(bucket.next.state)}</dd>
								</div>
								{bucket.next.output ? (
									<div>
										<dt>Next output</dt>
										<dd>{bucket.next.output}</dd>
									</div>
								) : null}
							</dl>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}
