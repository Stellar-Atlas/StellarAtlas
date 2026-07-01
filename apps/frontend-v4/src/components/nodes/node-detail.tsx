import Link from 'next/link';
import type {
	PublicHistoryArchiveScan,
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
	formatInteger,
	formatPercent
} from '../../format/formatters';
import { StatusTags } from '../status-tags';

interface NodeDetailProps {
	historyArchiveScan: PublicHistoryArchiveScan | null;
	network: PublicNetwork;
	node: PublicNode;
}

export function NodeDetail({
	historyArchiveScan,
	network,
	node
}: NodeDetailProps): React.JSX.Element {
	const organization = getOrganizationForNode(network, node);
	const archiveErrors = getArchiveErrors(historyArchiveScan);
	const showArchivePanel =
		node.historyArchiveHasError || archiveErrors.length > 0 || historyArchiveScan !== null;

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
						<dd>{formatPercent(node.statistics.active24HoursPercentage)}</dd>
					</div>
					<div>
						<dt>24H validating</dt>
						<dd>{formatPercent(node.statistics.validating24HoursPercentage)}</dd>
					</div>
					<div>
						<dt>30D active</dt>
						<dd>{formatPercent(node.statistics.active30DaysPercentage)}</dd>
					</div>
					<div>
						<dt>30D validating</dt>
						<dd>{formatPercent(node.statistics.validating30DaysPercentage)}</dd>
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
							{archiveErrors.map((error) => (
								<li key={`${error.url}:${error.message}`}>
									<a href={error.url} rel="noopener noreferrer" target="_blank">
										{error.url}
									</a>
									<span>{error.message}</span>
								</li>
							))}
						</ul>
					) : null}
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
