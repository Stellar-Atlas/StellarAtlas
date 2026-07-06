import Link from 'next/link';
import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveState,
	PublicKnownNode,
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import {
	getNodeTags,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';
import {
	formatBoolean,
	formatDateTime
} from '../../format/formatters';
import {
	formatNode24HourActive,
	formatNode24HourValidating,
	formatNode30DayActive,
	formatNode30DayValidating
} from '../../domain/availability';
import { StatusTags } from '../status-tags';
import { ArchiveMetadata } from './node-archive-evidence';
import { HistoryArchiveObjectInventory } from '@components/archive-scans/history-archive-object-inventory';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { HistoryArchiveObjectCoverage } from '@components/archive-scans/history-archive-object-coverage';

interface NodeDetailProps {
	historyArchiveBucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	historyArchiveEvidence: PublicHistoryArchiveScanEvidence | null;
	historyArchiveEvents: PublicHistoryArchiveObjectEvents | null;
	historyArchiveObjects: PublicHistoryArchiveObjectQueue | null;
	historyArchiveScan: PublicHistoryArchiveScan | null;
	historyArchiveScanLogs: readonly unknown[];
	historyArchiveState: PublicHistoryArchiveState | null;
	historyArchiveSummary: PublicHistoryArchiveObjectSummary | null;
	knownNode: PublicKnownNode;
	network: PublicNetwork;
	node: PublicNode | null;
	organization: PublicOrganization | null;
}

export function NodeDetail({
	historyArchiveBucketCoverages,
	historyArchiveEvents,
	historyArchiveObjects,
	historyArchiveScan,
	historyArchiveState,
	historyArchiveSummary,
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
	const active24Hours = formatNode24HourActive(node);
	const active30Days = formatNode30DayActive(node);
	const validating24Hours = formatNode24HourValidating(node);
	const validating30Days = formatNode30DayValidating(node);
	const hasHistoryArchive =
		typeof node.historyUrl === 'string' && node.historyUrl.length > 0;
	const showArchivePanel =
		hasHistoryArchive ||
		node.historyArchiveHasError ||
		historyArchiveScan !== null ||
		historyArchiveSummary !== null;

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
						<h2>Archive health</h2>
						{historyArchiveScan?.isSlow ? (
							<span className="tag warning">slow archive</span>
						) : null}
					</div>
					{historyArchiveSummary ? (
						<HistoryArchiveObjectCoverage
							framed={false}
							summary={historyArchiveSummary}
							title="Archive file coverage"
						/>
					) : null}
					<ArchiveMetadata
						historyArchiveScan={historyArchiveScan}
						historyArchiveState={historyArchiveState}
						node={node}
					/>
					{historyArchiveObjects ? (
						<HistoryArchiveObjectInventory
							bucketCoverages={historyArchiveBucketCoverages}
							framed={false}
							objects={historyArchiveObjects}
						/>
					) : null}
					{historyArchiveEvents ? (
						<HistoryArchiveObjectEventLog
							events={historyArchiveEvents}
							framed={false}
						/>
					) : null}
				</article>
			)}
		</section>
	);
}
