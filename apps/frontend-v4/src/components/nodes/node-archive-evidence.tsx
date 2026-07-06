import type {
	PublicHistoryArchiveScan,
	PublicHistoryArchiveState,
	PublicNode
} from '../../api/types';
import { HistoryArchiveStateDocument } from '../archive-scans/history-archive-state-document';

export function ArchiveMetadata({
	historyArchiveScan,
	historyArchiveState,
	node
}: {
	readonly historyArchiveScan: PublicHistoryArchiveScan | null;
	readonly historyArchiveState: PublicHistoryArchiveState | null;
	readonly node: PublicNode;
}): React.JSX.Element {
	const archiveMetadata = historyArchiveScan?.archiveMetadata ?? null;
	const historyUrl = node.historyUrl ?? historyArchiveScan?.url ?? null;

	if (archiveMetadata === null && historyUrl === null) {
		return (
			<div className="archive-log-section">
				<div className="panel-heading archive-log-heading">
					<h3>Scanner-captured archive metadata</h3>
				</div>
				<p className="muted-copy">No archive metadata URL is known.</p>
			</div>
		);
	}

	return (
		<div className="archive-log-section archive-metadata">
			<div className="panel-heading archive-log-heading">
				<h3>Scanner-captured archive metadata</h3>
			</div>
			<HistoryArchiveStateDocument
				archiveState={historyArchiveState}
				archiveMetadata={archiveMetadata}
				archiveUrl={historyUrl}
			/>
		</div>
	);
}
