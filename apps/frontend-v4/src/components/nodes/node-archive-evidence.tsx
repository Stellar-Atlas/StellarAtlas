import type { PublicHistoryArchiveState, PublicNode } from '../../api/types';
import { HistoryArchiveStateDocument } from '../archive-scans/history-archive-state-document';

export function ArchiveMetadata({
	historyArchiveState,
	node
}: {
	readonly historyArchiveState: PublicHistoryArchiveState | null;
	readonly node: PublicNode;
}): React.JSX.Element {
	const historyUrl = node.historyUrl;

	if (historyArchiveState === null && historyUrl === null) {
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
				archiveUrl={historyUrl}
			/>
		</div>
	);
}
