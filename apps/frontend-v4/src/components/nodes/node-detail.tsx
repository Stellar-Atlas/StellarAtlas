import Link from 'next/link';
import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveScanLogEntry,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveState,
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
	getArchiveVerificationErrors,
	scanLogIsActive
} from '../../domain/history-archive';
import { StatusTags } from '../status-tags';
import { HistoryArchiveScanLog } from './history-archive-scan-log';
import {
	ArchiveBucketEvidence,
	ArchiveMetadata
} from './node-archive-evidence';
import { HistoryArchiveObjectInventory } from '@components/archive-scans/history-archive-object-inventory';

interface NodeDetailProps {
	historyArchiveEvidence: PublicHistoryArchiveScanEvidence | null;
	historyArchiveObjects: PublicHistoryArchiveObjectQueue | null;
	historyArchiveScan: PublicHistoryArchiveScan | null;
	historyArchiveScanLogs: readonly PublicHistoryArchiveScanLogEntry[];
	historyArchiveState: PublicHistoryArchiveState | null;
	knownNode: PublicKnownNode;
	network: PublicNetwork;
	node: PublicNode | null;
	organization: PublicOrganization | null;
}

export function NodeDetail({
	historyArchiveEvidence,
	historyArchiveObjects,
	historyArchiveScan,
	historyArchiveScanLogs,
	historyArchiveState,
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

	const organization =
		routeOrganization ?? getOrganizationForNode(network, node);
	const archiveErrors = getArchiveErrors(historyArchiveScan);
	const archiveVerificationErrors = getArchiveVerificationErrors(archiveErrors);
	const activeArchiveRun = historyArchiveScanLogs.find(scanLogIsActive) ?? null;
	const latestCompletedArchiveRun =
		historyArchiveScanLogs.find((entry) => !scanLogIsActive(entry)) ?? null;
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
								<dt>Active progress</dt>
								<dd>
									{activeArchiveRun
										? `${formatActiveArchiveRun(activeArchiveRun)} updated ${formatDateTime(activeArchiveRun.updatedAt)}`
										: 'No active queue row in the current scanner snapshot'}
								</dd>
							</div>
							<div>
								<dt>Completed evidence</dt>
								<dd>
									{latestCompletedArchiveRun
										? `${latestCompletedArchiveRun.status} at ${formatDateTime(latestCompletedArchiveRun.endDate)}`
										: 'No completed scan evidence row is available yet'}
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
						historyArchiveState={historyArchiveState}
						node={node}
						organization={organization}
					/>
					<ArchiveBucketEvidence evidence={historyArchiveEvidence} />
					{historyArchiveObjects ? (
						<HistoryArchiveObjectInventory
							framed={false}
							objects={historyArchiveObjects}
						/>
					) : null}
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

function formatActiveArchiveRun(
	entry: PublicHistoryArchiveScanLogEntry
): string {
	if (entry.status === 'queued') return 'queued for a worker';
	if (entry.status === 'starting') return 'starting scanner work';
	if (entry.status === 'scanning') return 'scanner is verifying ledgers';
	return 'scanner heartbeat is delayed';
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
