import Link from 'next/link';
import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanLogEntry,
	PublicNetwork,
	PublicNode
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
import { StatusTags } from '../status-tags';
import { HistoryArchiveScanLog } from './history-archive-scan-log';

interface NodeDetailProps {
	historyArchiveScan: PublicHistoryArchiveScan | null;
	historyArchiveScanLogs: readonly PublicHistoryArchiveScanLogEntry[];
	network: PublicNetwork;
	node: PublicNode;
}

export function NodeDetail({
	historyArchiveScan,
	historyArchiveScanLogs,
	network,
	node
}: NodeDetailProps): React.JSX.Element {
	const organization = getOrganizationForNode(network, node);
	const archiveErrors = getArchiveErrors(historyArchiveScan);
	const active24Hours = formatNode24HourActive(node);
	const active30Days = formatNode30DayActive(node);
	const validating24Hours = formatNode24HourValidating(node);
	const validating30Days = formatNode30DayValidating(node);
	const hasHistoryArchive =
		typeof node.historyUrl === 'string' && node.historyUrl.length > 0;
	const showArchivePanel =
		hasHistoryArchive ||
		node.historyArchiveHasError ||
		archiveErrors.length > 0 ||
		historyArchiveScan !== null;

	return (
		<section className="detail-grid">
			<article className="panel detail-panel">
				<div className="panel-heading">
					<h2>Node status</h2>
					<StatusTags tags={getNodeTags(node)} />
				</div>
				<dl className="details">
					<div><dt>Public key</dt><dd>{node.publicKey}</dd></div>
					<div><dt>Host</dt><dd>{node.host ?? node.ip}</dd></div>
					<div><dt>Port</dt><dd>{node.port}</dd></div>
					<div><dt>Version</dt><dd>{node.versionStr ?? 'Unknown'}</dd></div>
					<div><dt>Ledger protocol</dt><dd>{node.ledgerVersion ?? 'Unknown'}</dd></div>
					<div><dt>Validating</dt><dd>{formatBoolean(node.isValidating)}</dd></div>
					<div><dt>Full validator</dt><dd>{formatBoolean(node.isFullValidator)}</dd></div>
					<div>
						<dt>Organization</dt>
						<dd>
							{organization ? (
								<Link href={`/organizations/${encodeURIComponent(organization.id)}`}>
									{getOrganizationLabel(organization)}
								</Link>
							) : 'Unassigned'}
						</dd>
					</div>
				</dl>
			</article>
			<article className="panel detail-panel">
				<div className="panel-heading"><h2>Availability</h2></div>
				<dl className="details">
					<div>
						<dt>24H active</dt>
						<dd className={`metric-text ${active24Hours.tone}`}>{active24Hours.value}</dd>
					</div>
					<div>
						<dt>24H validating</dt>
						<dd className={`metric-text ${validating24Hours.tone}`}>{validating24Hours.value}</dd>
					</div>
					<div>
						<dt>30D active</dt>
						<dd>
							<span className={`metric-text ${active30Days.tone}`}>{active30Days.value}</span>
							{active30Days.detail ? <small>{active30Days.detail}</small> : null}
						</dd>
					</div>
					<div>
						<dt>30D validating</dt>
						<dd>
							<span className={`metric-text ${validating30Days.tone}`}>{validating30Days.value}</span>
							{validating30Days.detail ? <small>{validating30Days.detail}</small> : null}
						</dd>
					</div>
					<div><dt>Country</dt><dd>{node.geoData?.countryName ?? 'Unknown'}</dd></div>
					<div><dt>ISP</dt><dd>{node.isp ?? 'Unknown'}</dd></div>
					<div><dt>History archive</dt><dd>{node.historyUrl ?? 'None reported'}</dd></div>
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
								<dt>Last scan</dt>
								<dd>{formatDateTime(historyArchiveScan.endDate)}</dd>
							</div>
							<div>
								<dt>Latest verified</dt>
								<dd>{formatInteger(historyArchiveScan.latestVerifiedLedger)}</dd>
							</div>
							<div>
								<dt>Scan status</dt>
								<dd>{historyArchiveScan.hasError ? 'Verification errors' : 'No verification errors'}</dd>
							</div>
						</dl>
					) : (
						<p className="muted-copy">No completed archive scan is available yet.</p>
					)}
					{archiveErrors.length > 0 ? (
						<ul className="archive-error-list">
							{archiveErrors.map((error, index) => (
								<li key={`${error.type}:${error.url}:${error.message}:${index}`}>
									<a href={error.url} rel="noopener noreferrer" target="_blank">
										{error.url}
									</a>
									<span>{error.message}</span>
								</li>
							))}
						</ul>
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
