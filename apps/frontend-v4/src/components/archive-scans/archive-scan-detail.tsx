import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveState
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { HistoryArchiveStateDocument } from './history-archive-state-document';
import { HistoryArchiveObjectCoverage } from './history-archive-object-coverage';
import { HistoryArchiveObjectInventory } from './history-archive-object-inventory';
import { HistoryArchiveObjectEventLog } from './history-archive-object-event-log';

interface ArchiveScanDetailProps {
	readonly bucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly events: PublicHistoryArchiveObjectEvents;
	readonly historyUrl: string;
	readonly objects: PublicHistoryArchiveObjectQueue;
	readonly scan: PublicHistoryArchiveScan | null;
	readonly state: PublicHistoryArchiveState | null;
	readonly summary: PublicHistoryArchiveObjectSummary;
}

export function ArchiveScanDetail({
	bucketCoverages,
	events,
	historyUrl,
	objects,
	scan,
	state,
	summary
}: ArchiveScanDetailProps): React.JSX.Element {
	return (
		<section className="detail-grid">
			<HistoryArchiveObjectCoverage
				summary={summary}
				title="Archive evidence checks"
			/>
			<article className="panel detail-panel archive-panel">
				<div className="panel-heading">
					<h2>History archive state</h2>
				</div>
				<ArchiveMetadata historyUrl={historyUrl} state={state} />
				<LegacyRangeScanSummary scan={scan} />
			</article>
			<HistoryArchiveObjectInventory
				bucketCoverages={bucketCoverages}
				objects={objects}
				title="Archive file-check sample"
			/>
			<HistoryArchiveObjectEventLog
				events={events}
				title="Recent archive file activity"
			/>
		</section>
	);
}

function ArchiveMetadata({
	historyUrl,
	state
}: {
	readonly historyUrl: string;
	readonly state: PublicHistoryArchiveState | null;
}): React.JSX.Element {
	return (
		<HistoryArchiveStateDocument
			archiveState={state}
			archiveUrl={historyUrl}
		/>
	);
}

function LegacyRangeScanSummary({
	scan
}: {
	readonly scan: PublicHistoryArchiveScan | null;
}): React.JSX.Element | null {
	if (scan === null) return null;

	return (
		<details className="metadata-document nested-metadata-document">
			<summary>
				<span>Historical range-scan record</span>
				<span className="muted-inline">not current archive health</span>
			</summary>
			<p className="muted-copy">
				This older range-scan row is retained for audit context. Current archive
				health is driven by the archive file checks above.
			</p>
			<dl className="details">
				<div>
					<dt>Last range scan</dt>
					<dd>{formatDateTime(scan.endDate)}</dd>
				</div>
				<div>
					<dt>Latest verified ledger</dt>
					<dd>{formatInteger(scan.latestVerifiedLedger)}</dd>
				</div>
				<div>
					<dt>Historical errors</dt>
					<dd>{formatInteger(scan.errors.length)}</dd>
				</div>
			</dl>
			{scan.archiveMetadata ? (
				<details className="metadata-document nested-metadata-document">
					<summary>
						<span>Historical captured metadata</span>
					</summary>
					<pre>{JSON.stringify(scan.archiveMetadata, null, 2)}</pre>
				</details>
			) : null}
		</details>
	);
}
