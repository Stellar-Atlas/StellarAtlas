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
			<div className="archive-log-section archive-metadata">
				<details className="metadata-document history-archive-state">
					<summary>
						<span>History archive state</span>
						<span className="muted-inline">No archive URL</span>
					</summary>
					<p className="muted-copy">No archive metadata URL is known.</p>
				</details>
			</div>
		);
	}

	return (
		<div className="archive-log-section archive-metadata">
			<HistoryArchiveStateDocument
				archiveState={historyArchiveState}
				archiveMetadata={archiveMetadata}
				archiveUrl={historyUrl}
			/>
		</div>
	);
}
