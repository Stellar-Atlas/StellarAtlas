'use client';

import { useEffect, useState } from 'react';
import { subscribeToStatusStream } from '@api/status-live-stream';
import type { ArchiveWorkerStatusRowDTO, PublicWorkerStatus } from '@api/types';
import { formatInteger } from '@format/formatters';
import { LocalDateTime } from '../local-date-time';
import {
	getArchiveSourceRuntime,
	selectSourceWorkerSnapshot,
	type ArchiveSourceRuntimeModel
} from './archive-source-runtime-model';

export function ArchiveSourceRuntime({
	archiveUrl
}: {
	readonly archiveUrl: string;
}): React.JSX.Element {
	const [state, setState] = useState({
		workers: null as PublicWorkerStatus | null,
		lastReceivedAt: null as number | null,
		startedAt: 0,
		now: 0,
		streamError: false
	});
	useEffect(() => {
		const startedAt = Date.now();
		setState((current) => ({ ...current, startedAt, now: startedAt }));
		const unsubscribe = subscribeToStatusStream((message) => {
			if (message.type === 'error') {
				setState((current) => ({
					...current,
					streamError: true,
					now: Date.now()
				}));
				return;
			}
			const incoming = message.payload.workers;
			if (incoming === undefined) return;
			setState((current) => {
				const workers = selectSourceWorkerSnapshot(current.workers, incoming);
				if (workers !== incoming) return current;
				const now = Date.now();
				return {
					...current,
					workers,
					now,
					lastReceivedAt: now,
					streamError: false
				};
			});
		});
		const timer = window.setInterval(() => {
			setState((current) => ({ ...current, now: Date.now() }));
		}, 5_000);
		return () => {
			window.clearInterval(timer);
			unsubscribe();
		};
	}, []);
	return (
		<ArchiveSourceRuntimeView
			model={getArchiveSourceRuntime({ archiveUrl, ...state })}
		/>
	);
}

export function ArchiveSourceRuntimeView({
	model
}: {
	readonly model: ArchiveSourceRuntimeModel;
}): React.JSX.Element {
	return (
		<section
			className="archive-source-runtime"
			aria-label="Live source worker activity"
		>
			<h3>Worker activity for this source</h3>
			<p role="status">
				{model.status === 'connecting'
					? 'Connecting worker telemetry…'
					: model.status === 'unavailable'
						? 'Worker telemetry unavailable. Current activity is unknown.'
						: model.status === 'stale'
							? 'Worker telemetry is stale or unavailable. Current activity is unknown.'
							: model.activeRows.length > 0
								? `${formatInteger(model.activeRows.length)} active worker slots reported for this source.`
								: model.completeTelemetry
									? 'No active worker slots reported for this source in the latest snapshot.'
									: 'No active worker slots reported for this source; worker telemetry is incomplete.'}
			</p>
			{model.generatedAt === null ? null : (
				<p className="muted-copy">
					Worker snapshot: <LocalDateTime dateTime={model.generatedAt} />
				</p>
			)}
			{model.status === 'current' ? (
				<RuntimeRows rows={model.activeRows} />
			) : null}
			{model.status === 'stale' && model.lastReportedRows.length > 0 ? (
				<details>
					<summary>Last reported slots (not live)</summary>
					<RuntimeRows rows={model.lastReportedRows} />
				</details>
			) : null}
		</section>
	);
}

function RuntimeRows({
	rows
}: {
	readonly rows: readonly ArchiveWorkerStatusRowDTO[];
}): React.JSX.Element | null {
	if (rows.length === 0) return null;
	return (
		<ul className="archive-source-runtime-slots">
			{rows.map((worker) => (
				<li key={worker.workerId}>
					<strong>Slot {worker.slotIndex}</strong> ·{' '}
					{worker.currentObject?.type} · {worker.stage.replace(/_/g, ' ')}
					{worker.bytesDownloaded === null
						? null
						: ` · ${formatInteger(worker.bytesDownloaded)} bytes received`}
				</li>
			))}
		</ul>
	);
}
