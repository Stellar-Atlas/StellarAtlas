import Link from 'next/link';
import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveScanLogEntry,
	PublicKnownNode,
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import {
	getNodeLabel,
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import {
	formatBoolean,
	formatDateTime,
	formatInteger
} from '../../format/formatters';
import {
	formatNode24HourActive,
	formatNode24HourValidating,
	formatNode30DayActive,
	formatNode30DayValidating
} from '../../domain/availability';
import {
	getArchiveVerificationErrors
} from '../../domain/history-archive';
import { StatusTags } from '../status-tags';
import { HistoryArchiveScanLog } from './history-archive-scan-log';

interface NodeDetailProps {
	historyArchiveEvidence: PublicHistoryArchiveScanEvidence | null;
	historyArchiveScan: PublicHistoryArchiveScan | null;
	historyArchiveScanLogs: readonly PublicHistoryArchiveScanLogEntry[];
	knownNode: PublicKnownNode;
	network: PublicNetwork;
	node: PublicNode | null;
	organization: PublicOrganization | null;
}

export function NodeDetail({
	historyArchiveEvidence,
	historyArchiveScan,
	historyArchiveScanLogs,
	knownNode,
	network,
	node,
	organization: routeOrganization
}: NodeDetailProps): React.JSX.Element {
	if (node === null) {
		return (
			<section className="detail-grid">
				<article className="panel detail-panel">
					<div className="panel-heading">
						<h2>Known public key</h2>
						<StatusTags
							tags={[{ label: 'public key only', tone: 'neutral' }]}
						/>
					</div>
					<dl className="details">
						<div>
							<dt>Public key</dt>
							<dd>{knownNode.publicKey}</dd>
						</div>
						<div>
							<dt>Date discovered</dt>
							<dd>{formatDateTime(knownNode.dateDiscovered)}</dd>
						</div>
						<div>
							<dt>Last seen</dt>
							<dd>
								{knownNode.lastSeen
									? formatDateTime(knownNode.lastSeen)
									: 'Unavailable'}
							</dd>
						</div>
						<div>
							<dt>Metadata</dt>
							<dd>No node snapshot is available.</dd>
						</div>
					</dl>
				</article>
			</section>
		);
	}

	const organization = routeOrganization ?? getOrganizationForNode(network, node);
	const archiveErrors = getArchiveErrors(historyArchiveScan);
	const archiveVerificationErrors = getArchiveVerificationErrors(archiveErrors);
	const latestArchiveRun =
		historyArchiveScanLogs.find((entry) => entry.status !== 'queued') ??
		historyArchiveScanLogs[0] ??
		null;
	const active24Hours = formatNode24HourActive(node);
	const active30Days = formatNode30DayActive(node);
	const validating24Hours = formatNode24HourValidating(node);
	const validating30Days = formatNode30DayValidating(node);
	const hasHistoryArchive =
		typeof node.historyUrl === 'string' && node.historyUrl.length > 0;
	const showArchivePanel =
		hasHistoryArchive ||
		node.historyArchiveHasError ||
		archiveVerificationErrors.length > 0 ||
		historyArchiveScan !== null ||
		historyArchiveScanLogs.length > 0;

	return (
		<section className="detail-grid">
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>Node status</h2>
					<StatusTags tags={getNodeTags(node)} />
				</div>
				<dl className="details">
					<div>
						<dt>Public key</dt>
						<dd>{node.publicKey}</dd>
					</div>
					<div>
						<dt>Host</dt>
						<dd>{node.host ?? node.ip}</dd>
					</div>
					<div>
						<dt>Port</dt>
						<dd>{node.port}</dd>
					</div>
					<div>
						<dt>Version</dt>
						<dd>{node.versionStr ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>Ledger protocol</dt>
						<dd>{node.ledgerVersion ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>Validating</dt>
						<dd>{formatBoolean(node.isValidating)}</dd>
					</div>
					<div>
						<dt>Full validator</dt>
						<dd>{formatBoolean(node.isFullValidator)}</dd>
					</div>
					<div>
						<dt>Organization</dt>
						<dd>
							{organization ? (
								<Link
									href={`/organizations/${encodeURIComponent(organization.id)}`}
								>
									{getOrganizationLabel(organization)}
								</Link>
							) : (
								'Unassigned'
							)}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>Availability</h2>
				</div>
				<dl className="details">
					<div>
						<dt>24H active</dt>
						<dd className={`metric-text ${active24Hours.tone}`}>
							{active24Hours.value}
						</dd>
					</div>
					<div>
						<dt>24H validating</dt>
						<dd className={`metric-text ${validating24Hours.tone}`}>
							{validating24Hours.value}
						</dd>
					</div>
					<div>
						<dt>30D active</dt>
						<dd>
							<span className={`metric-text ${active30Days.tone}`}>
								{active30Days.value}
							</span>
							{active30Days.detail ? (
								<small>{active30Days.detail}</small>
							) : null}
						</dd>
					</div>
					<div>
						<dt>30D validating</dt>
						<dd>
							<span className={`metric-text ${validating30Days.tone}`}>
								{validating30Days.value}
							</span>
							{validating30Days.detail ? (
								<small>{validating30Days.detail}</small>
							) : null}
						</dd>
					</div>
					<div>
						<dt>Country</dt>
						<dd>{node.geoData?.countryName ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>ISP</dt>
						<dd>{node.isp ?? 'Unknown'}</dd>
					</div>
					<div>
						<dt>History archive</dt>
						<dd>{node.historyUrl ?? 'None reported'}</dd>
					</div>
				</dl>
			</article>
			{showArchivePanel && (
				<article className="panel detail-panel archive-panel">
					<div className="panel-heading">
						<h2>History archive verification</h2>
						{historyArchiveScan?.isSlow ? (
							<span className="tag warning">slow archive</span>
						) : null}
					</div>
					{historyArchiveScan ? (
						<dl className="details">
							<div>
								<dt>Latest run</dt>
								<dd>
									{latestArchiveRun
										? `${latestArchiveRun.status} at ${formatDateTime(latestArchiveRun.updatedAt)}`
										: 'No recent scanner run'}
								</dd>
							</div>
							<div>
								<dt>Archive evidence</dt>
								<dd>{formatDateTime(historyArchiveScan.endDate)}</dd>
							</div>
							<div>
								<dt>Latest verified</dt>
								<dd>
									{formatInteger(historyArchiveScan.latestVerifiedLedger)}
								</dd>
							</div>
							<div>
								<dt>Archive status</dt>
								<dd>
									{archiveVerificationErrors.length > 0
										? 'Archive verification errors'
										: 'No archive verification errors'}
								</dd>
							</div>
						</dl>
					) : (
						<p className="muted-copy">
							No completed archive scan is available yet.
						</p>
					)}
					{archiveVerificationErrors.length > 0 ? (
						<p className="muted-copy">
							Archive verification errors are listed in the scan run log.
						</p>
					) : null}
					<ArchiveMetadata
						historyArchiveScan={historyArchiveScan}
						node={node}
						organization={organization}
					/>
					<ArchiveBucketEvidence evidence={historyArchiveEvidence} />
					<div className="archive-log-section">
						<div className="panel-heading archive-log-heading">
							<h3>Scan run log</h3>
						</div>
						<HistoryArchiveScanLog logs={historyArchiveScanLogs} />
					</div>
				</article>
			)}
		</section>
	);
}

function ArchiveMetadata({
	historyArchiveScan,
	node,
	organization
}: {
	readonly historyArchiveScan: PublicHistoryArchiveScan | null;
	readonly node: PublicNode;
	readonly organization: PublicOrganization | null;
}): React.JSX.Element {
	const archiveMetadata = historyArchiveScan?.archiveMetadata ?? null;
	const homeDomain = organization?.homeDomain ?? node.homeDomain;
	const stellarHistoryUrl = archiveMetadata?.stellarHistoryUrl ?? buildHistoryUrl(
		node.historyUrl
	);
	const stellarTomlUrl =
		organization?.stellarToml?.url ??
		(homeDomain === null
			? null
			: `https://${homeDomain}/.well-known/stellar.toml`);

	if (stellarHistoryUrl === null && stellarTomlUrl === null) {
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
			<MetadataDocument
				label="stellar-history.json"
				missingCopy="No scanner-captured stellar-history.json is available yet."
				text={
					archiveMetadata === null
						? null
						: formatPersistedJson(archiveMetadata.stellarHistory)
				}
				url={stellarHistoryUrl}
			/>
			<MetadataDocument
				label="stellar.toml"
				missingCopy={formatTomlMissingCopy(organization)}
				text={getPersistedTomlText(organization)}
				url={stellarTomlUrl}
			/>
		</div>
	);
}

function MetadataDocument({
	label,
	missingCopy,
	text,
	url
}: {
	readonly label: string;
	readonly missingCopy: string;
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
			{text ? <pre>{text}</pre> : <p className="muted-copy">{missingCopy}</p>}
		</details>
	);
}

function buildHistoryUrl(historyUrl: string | null): string | null {
	if (historyUrl === null) return null;
	const withSlash = historyUrl.endsWith('/') ? historyUrl : `${historyUrl}/`;
	return new URL('.well-known/stellar-history.json', withSlash).toString();
}

function formatPersistedJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
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

	return `No scanner-captured stellar.toml text is available yet. Current TOML state is ${organization.tomlState}.`;
}

function ArchiveBucketEvidence({
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
					No verified bucket evidence has been recorded yet.
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
					No verified bucket evidence has been recorded yet.
				</p>
			) : (
				<ul className="archive-bucket-evidence-list">
					{evidence.evidence.map((entry) => (
						<li key={`${entry.bucketHash}:${entry.observedAt}`}>
							<a
								href={entry.bucketUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								{entry.bucketHash}
							</a>
							<span>{formatDateTime(entry.observedAt)}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

const getArchiveErrors = (
	scan: PublicHistoryArchiveScan | null
): PublicHistoryArchiveScan['errors'] => {
	if (scan === null) return [];
	if (scan.errors.length > 0) return scan.errors;
	if (scan.errorUrl === null || scan.errorMessage === null) return [];

	return [
		{
			message: scan.errorMessage,
			type: 'TYPE_VERIFICATION',
			url: scan.errorUrl
		}
	];
};
