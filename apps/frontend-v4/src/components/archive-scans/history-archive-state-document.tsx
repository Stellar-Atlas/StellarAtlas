import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveState
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';

type HistoryArchiveMetadata = NonNullable<
	PublicHistoryArchiveScan['archiveMetadata']
>;
export function HistoryArchiveStateDocument({
	archiveState = null,
	archiveMetadata = null,
	archiveUrl = null
}: {
	readonly archiveState?: PublicHistoryArchiveState | null;
	readonly archiveMetadata?: HistoryArchiveMetadata | null;
	readonly archiveUrl?: string | null;
}): React.JSX.Element | null {
	if (archiveState !== null && archiveState.status !== 'available') {
		return <HistoryArchiveStateFailure archiveState={archiveState} />;
	}

	const resolvedMetadata = archiveState?.metadata ?? archiveMetadata;

	if (resolvedMetadata === null) {
		return <MissingHistoryArchiveState archiveUrl={archiveUrl} />;
	}

	const state = resolvedMetadata.stellarHistory;
	const hotArchiveBuckets = state.hotArchiveBuckets ?? [];
	const archiveRootUrl = getArchiveRootUrl(resolvedMetadata.stellarHistoryUrl);

	return (
		<details className="metadata-document history-archive-state">
			<summary>
				<span>History archive state</span>
				<span className="muted-inline">{archiveRootUrl}</span>
			</summary>
			<p className="muted-copy">
				History archive state observed {formatDateTime(resolvedMetadata.observedAt)}.
			</p>
			<dl className="details">
				<div>
					<dt>Archive source</dt>
					<dd>{archiveRootUrl}</dd>
				</div>
				<div>
					<dt>State file</dt>
					<dd>{resolvedMetadata.stellarHistoryUrl}</dd>
				</div>
				<div>
					<dt>Version</dt>
					<dd>{formatInteger(state.version)}</dd>
				</div>
				<div>
					<dt>Server</dt>
					<dd>{state.server}</dd>
				</div>
				<div>
					<dt>State current ledger</dt>
					<dd>{formatInteger(state.currentLedger)}</dd>
				</div>
				<div>
					<dt>Network passphrase</dt>
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
				{archiveState?.latestFailure ? (
					<>
						<div>
							<dt>Latest failed refresh</dt>
							<dd>{formatDateTime(archiveState.latestFailure.observedAt)}</dd>
						</div>
						<div>
							<dt>Refresh failure</dt>
							<dd>{archiveState.latestFailure.type}</dd>
						</div>
					</>
				) : null}
			</dl>
			{archiveState?.latestFailure ? (
				<p className="muted-copy">
					Latest failed refresh: {archiveState.latestFailure.message}
				</p>
			) : null}
			<details className="metadata-document nested-metadata-document">
				<summary>
					<span>Raw bucket state JSON</span>
				</summary>
				<pre>{JSON.stringify(state, null, 2)}</pre>
			</details>
		</details>
	);
}

function HistoryArchiveStateFailure({
	archiveState
}: {
	readonly archiveState: PublicHistoryArchiveState;
}): React.JSX.Element {
	return (
		<details className="metadata-document history-archive-state">
			<summary>
				<span>History archive state</span>
				<span className="muted-inline">{getArchiveRootUrl(archiveState.stateUrl)}</span>
			</summary>
			<dl className="details">
				<div>
					<dt>Status</dt>
					<dd>{archiveState.status}</dd>
				</div>
				<div>
					<dt>Observed</dt>
					<dd>{formatDateTime(archiveState.observedAt)}</dd>
				</div>
				<div>
					<dt>Source</dt>
					<dd>{archiveState.source}</dd>
				</div>
				<div>
					<dt>Failure type</dt>
					<dd>{archiveState.failure?.type ?? 'unknown'}</dd>
				</div>
				<div>
					<dt>Latest failed refresh</dt>
					<dd>
						{archiveState.latestFailure
							? formatDateTime(archiveState.latestFailure.observedAt)
							: 'Not reported'}
					</dd>
				</div>
				<div>
					<dt>HTTP status</dt>
					<dd>
						{archiveState.failure?.httpStatus === null ||
						archiveState.failure?.httpStatus === undefined
							? 'Not reported'
							: formatInteger(archiveState.failure.httpStatus)}
					</dd>
				</div>
			</dl>
			<p className="muted-copy">
				{archiveState.failure?.message ??
					'No valid history archive state document is stored for this archive.'}
			</p>
		</details>
	);
}

function MissingHistoryArchiveState({
	archiveUrl
}: {
	readonly archiveUrl: string | null;
}): React.JSX.Element {
	const stellarHistoryUrl =
		archiveUrl === null ? null : buildStellarHistoryUrl(archiveUrl);

	return (
		<details className="metadata-document history-archive-state">
			<summary>
				<span>History archive state</span>
				<span className="muted-inline">
					{stellarHistoryUrl === null ? 'No archive URL' : getArchiveRootUrl(stellarHistoryUrl)}
				</span>
			</summary>
			<p className="muted-copy">
				No history archive state is stored for this archive yet.
			</p>
		</details>
	);
}

function getArchiveRootUrl(stellarHistoryUrl: string): string {
	return stellarHistoryUrl.replace(
		/\/\.well-known\/stellar-history\.json$/,
		''
	);
}

function buildStellarHistoryUrl(archiveUrl: string): string {
	return `${archiveUrl.replace(/\/+$/, '')}/.well-known/stellar-history.json`;
}
