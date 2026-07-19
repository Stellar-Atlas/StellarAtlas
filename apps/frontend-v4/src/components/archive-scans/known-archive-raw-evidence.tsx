'use client';

import { useState } from 'react';
import type { PublicKnownArchiveEvidence } from '@domain/known-archive-evidence';

export function KnownArchiveRawEvidence({
	evidence
}: {
	readonly evidence: PublicKnownArchiveEvidence;
}): React.JSX.Element {
	const [expanded, setExpanded] = useState(false);
	return (
		<details
			className="metadata-document known-evidence-raw"
			onToggle={(event) => setExpanded(event.currentTarget.open)}
		>
			<summary>
				<span>Raw initial API response</span>
				<span className="muted-inline">JSON</span>
			</summary>
			{expanded ? <pre>{JSON.stringify(evidence, null, 2)}</pre> : null}
		</details>
	);
}
