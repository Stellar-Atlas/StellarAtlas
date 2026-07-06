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
		<details className="metadata-document history-archive-state" open>
			<summary>
				<span>History archive state</span>
				<a
					href={resolvedMetadata.stellarHistoryUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					{resolvedMetadata.stellarHistoryUrl}
				</a>
			</summary>
			<p className="muted-copy">
				Archive root state file captured by the scanner{' '}
				{formatDateTime(resolvedMetadata.observedAt)}.
			</p>
			<dl className="details">
				<div>
					<dt>Archive root</dt>
					<dd>{archiveRootUrl}</dd>
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
			</dl>
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
		<details className="metadata-document history-archive-state" open>
			<summary>
				<span>History archive state</span>
				<a
					href={archiveState.stateUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					{archiveState.stateUrl}
				</a>
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
					'The scanner has not captured a valid history archive state document for this archive.'}
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
		<details className="metadata-document history-archive-state" open>
			<summary>
				<span>History archive state</span>
				{stellarHistoryUrl === null ? (
					<span className="muted-inline">No archive URL</span>
				) : (
					<a href={stellarHistoryUrl} rel="noopener noreferrer" target="_blank">
						{stellarHistoryUrl}
					</a>
				)}
			</summary>
			<p className="muted-copy">
				No scanner-captured history archive state is stored for this archive
				yet.
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
