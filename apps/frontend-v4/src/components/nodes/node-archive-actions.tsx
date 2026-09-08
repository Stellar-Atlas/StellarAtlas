'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { getHttpUrl } from '../../domain/known-archive-evidence';
import { getArchiveScanDetailPath } from '../../domain/archive-scan-routes';
import { ArchiveRepairPlanPanel } from '../archive-scans/archive-repair-plan-panel';

export function NodeArchiveActions({
	archiveUrl
}: {
	readonly archiveUrl: string | null;
}): React.JSX.Element | null {
	const [open, setOpen] = useState(false);
	const id = useId();
	const url = getHttpUrl(archiveUrl);
	if (!url) return null;
	return (
		<section
			className="panel detail-panel node-detail-wide node-archive-actions"
			aria-label="Advertised archive source"
		>
			<div className="panel-heading">
				<h2>Archive source</h2>
			</div>
			<p>
				<a href={url} rel="noreferrer" target="_blank">
					{url}
				</a>
			</p>
			<div className="node-archive-action-links">
				<Link className="primary-button" href={getArchiveScanDetailPath(url)}>
					Inspect archive
				</Link>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => setOpen((value) => !value)}
				>
					Repair / download options
				</button>
			</div>
			<p className="muted-copy">
				View this archive’s findings and replacement-file options. Opening a
				repair plan makes no changes.
			</p>
			<div id={id}>
				{open ? <ArchiveRepairPlanPanel key={url} archiveUrl={url} /> : null}
			</div>
		</section>
	);
}
