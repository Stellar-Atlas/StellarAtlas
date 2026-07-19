import type {
	PublicHistoryArchiveState,
	PublicKnownNodeArchiveEvidence
} from '../../api/archive-evidence-types';
import type { PublicNode } from '../../api/types';
import { KnownArchiveEvidence } from '../archive-scans/known-archive-evidence';
import { HistoryArchiveStateDocument } from '../archive-scans/history-archive-state-document';

export function NodeArchiveEvidence({
	evidence,
	publicKey
}: {
	readonly evidence: PublicKnownNodeArchiveEvidence;
	readonly publicKey: string;
}): React.JSX.Element {
	return (
		<KnownArchiveEvidence
			evidence={evidence}
			subject={{ id: publicKey, kind: 'node' }}
			title="Archive health"
		/>
	);
}

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
