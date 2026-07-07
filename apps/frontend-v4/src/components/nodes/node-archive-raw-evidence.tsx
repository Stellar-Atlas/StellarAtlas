import type {
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveState
} from '@api/types';

interface NodeArchiveRawEvidenceProps {
	readonly events: PublicHistoryArchiveObjectEvents | null;
	readonly objects: PublicHistoryArchiveObjectQueue | null;
	readonly state: PublicHistoryArchiveState | null;
	readonly summary: PublicHistoryArchiveObjectSummary | null;
}

export function NodeArchiveRawEvidence({
	events,
	objects,
	state,
	summary
}: NodeArchiveRawEvidenceProps): React.JSX.Element {
	return (
		<div className="archive-raw-evidence">
			<RawJsonDetails label="Summary JSON" value={summary} />
			<RawJsonDetails label="History archive state JSON" value={state} />
			<RawJsonDetails
				label="Current work sample JSON"
				value={
					objects ? { ...objects, objects: objects.objects.slice(0, 20) } : null
				}
			/>
			<RawJsonDetails
				label="Recent event sample JSON"
				value={
					events ? { ...events, events: events.events.slice(0, 20) } : null
				}
			/>
		</div>
	);
}

function RawJsonDetails({
	label,
	value
}: {
	readonly label: string;
	readonly value: unknown;
}): React.JSX.Element {
	return (
		<details className="metadata-document">
			<summary>
				<span>{label}</span>
				<span className="muted-inline">
					{value === null ? 'not available' : 'available'}
				</span>
			</summary>
			<pre>{JSON.stringify(value, null, 2)}</pre>
		</details>
	);
}
