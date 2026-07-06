import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveState,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import { formatDateTime, formatInteger } from '../../format/formatters';
import { HistoryArchiveStateDocument } from '../archive-scans/history-archive-state-document';

export function ArchiveMetadata({
	historyArchiveScan,
	historyArchiveState,
	node,
	organization
}: {
	readonly historyArchiveScan: PublicHistoryArchiveScan | null;
	readonly historyArchiveState: PublicHistoryArchiveState | null;
	readonly node: PublicNode;
	readonly organization: PublicOrganization | null;
}): React.JSX.Element {
	const archiveMetadata = historyArchiveScan?.archiveMetadata ?? null;
	const historyUrl = node.historyUrl ?? historyArchiveScan?.url ?? null;
	const homeDomain = organization?.homeDomain ?? node.homeDomain;
	const stellarTomlUrl =
		organization?.stellarToml?.url ??
		(homeDomain === null
			? null
			: `https://${homeDomain}/.well-known/stellar.toml`);

	if (
		archiveMetadata === null &&
		historyUrl === null &&
		stellarTomlUrl === null
	) {
		return (
			<div className="archive-log-section">
				<div className="panel-heading archive-log-heading">
					<h3>Archive metadata</h3>
				</div>
				<p className="muted-copy">No archive or TOML metadata URL is known.</p>
			</div>
		);
	}

	return (
		<div className="archive-log-section archive-metadata">
			<div className="panel-heading archive-log-heading">
				<h3>Archive metadata</h3>
			</div>
			<HistoryArchiveStateDocument
				archiveState={historyArchiveState}
				archiveMetadata={archiveMetadata}
				archiveUrl={historyUrl}
			/>
			<MetadataDocument
				capturedAt={null}
				label="stellar.toml"
				missingCopy={formatTomlMissingCopy(organization)}
				text={getPersistedTomlText(organization)}
				url={stellarTomlUrl}
			/>
		</div>
	);
}

export function ArchiveBucketEvidence({
	evidence
}: {
	readonly evidence: PublicHistoryArchiveScanEvidence | null;
}): React.JSX.Element {
	if (evidence === null) {
		return (
			<div className="archive-log-section">
				<div className="panel-heading archive-log-heading">
					<h3>Verified bucket evidence</h3>
				</div>
				<p className="muted-copy">
					The bucket evidence endpoint has not returned a scanner snapshot for
					this archive yet.
				</p>
			</div>
		);
	}

	const visibleCount = evidence.evidence.length;
	const countLabel =
		evidence.count > visibleCount
			? `${formatInteger(visibleCount)} / ${formatInteger(evidence.count)} verified buckets`
			: `${formatInteger(evidence.count)} verified buckets`;

	return (
		<div className="archive-log-section">
			<div className="panel-heading archive-log-heading">
				<h3>Verified bucket evidence</h3>
				<span className="muted-inline">{countLabel}</span>
			</div>
			{evidence.evidence.length === 0 ? (
				<p className="muted-copy">
					No verified bucket rows have been persisted yet. Completed scan
					evidence can exist before bucket evidence backfill is available.
				</p>
			) : (
				<ul className="archive-bucket-evidence-list">
					{evidence.evidence.map((entry) => (
						<li key={`${entry.bucketHash}:${entry.observedAt}`}>
							<BucketEvidenceLink entry={entry} />
							<span>{formatDateTime(entry.observedAt)}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function MetadataDocument({
	capturedAt,
	label,
	missingCopy,
	text,
	url
}: {
	readonly capturedAt: string | null;
	readonly label: string;
	readonly missingCopy?: string;
	readonly text: string | null;
	readonly url: string | null;
}): React.JSX.Element {
	return (
		<details className="metadata-document" open>
			<summary>
				<span>{label}</span>
				{url ? (
					<a href={url} rel="noopener noreferrer" target="_blank">
						{url}
					</a>
				) : (
					<span className="muted-inline">No URL</span>
				)}
			</summary>
			{capturedAt ? (
				<p className="muted-copy">
					Scanner-captured copy observed {formatDateTime(capturedAt)}.
				</p>
			) : null}
			{text ? <pre>{text}</pre> : null}
			{text === null && missingCopy ? (
				<p className="muted-copy">{missingCopy}</p>
			) : null}
		</details>
	);
}

function BucketEvidenceLink({
	entry
}: {
	readonly entry: PublicHistoryArchiveScanEvidence['evidence'][number];
}): React.JSX.Element {
	if (!isPublicHttpUrl(entry.bucketUrl)) return <span>{entry.bucketHash}</span>;

	return (
		<a href={entry.bucketUrl} rel="noopener noreferrer" target="_blank">
			{entry.bucketHash}
		</a>
	);
}

function getPersistedTomlText(
	organization: PublicOrganization | null
): string | null {
	return organization?.stellarToml?.content ?? null;
}

function formatTomlMissingCopy(
	organization: PublicOrganization | null
): string {
	if (organization === null) {
		return 'No organization is assigned, so no persisted stellar.toml is available.';
	}

	return `No persisted scanner copy of stellar.toml is available yet. Current TOML state is ${organization.tomlState}. This is stored scanner evidence, not a browser-time fetch from the organization.`;
}

function isPublicHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}
