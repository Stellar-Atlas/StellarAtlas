'use client';

import { useEffect, useState } from 'react';
import { subscribeToStatusStream } from '@api/status-live-stream';
import { StatusDashboard, type StatusDashboardProps } from './status-dashboard';
import {
	selectArchiveEvidence,
	statusUpdatesAreStale
} from './status-live-freshness';

export function StatusDashboardLive(
	props: StatusDashboardProps
): React.JSX.Element {
	const [dashboardProps, setDashboardProps] = useState(props);
	const [streamState, setStreamState] = useState<
		'connecting' | 'live' | 'stale'
	>('connecting');

	useEffect(() => {
		setDashboardProps((current) => {
			const evidence = selectArchiveEvidence(
				current.archiveSummary,
				current.archiveEvidenceAvailable,
				props.archiveEvidenceAvailable ? props.archiveSummary : undefined
			);
			return {
				...props,
				archiveSummary: evidence.summary,
				archiveEvidenceAvailable: evidence.available
			};
		});
	}, [props]);

	useEffect(() => {
		let lastReceivedAt = Date.now();
		let receivedUpdate = false;
		let invalidUpdate = false;
		const timer = window.setInterval(() => {
			setStreamState(
				invalidUpdate || statusUpdatesAreStale(lastReceivedAt, Date.now())
					? 'stale'
					: receivedUpdate
						? 'live'
						: 'connecting'
			);
		}, 5_000);
		const unsubscribe = subscribeToStatusStream((message) => {
			if (message.type === 'error') {
				invalidUpdate = true;
				setStreamState('stale');
				return;
			}
			lastReceivedAt = Date.now();
			receivedUpdate = true;
			invalidUpdate = false;
			setStreamState('live');
			setDashboardProps((current) => {
				const evidence = selectArchiveEvidence(
					current.archiveSummary,
					current.archiveEvidenceAvailable,
					message.payload.archiveSummary
				);
				return {
					...current,
					api: message.payload.api ?? current.api,
					archiveEvents: message.payload.archiveEvents ?? current.archiveEvents,
					archiveEventsAvailable:
						message.payload.archiveEvents !== undefined ||
						current.archiveEventsAvailable,
					archiveEvidenceAvailable: evidence.available,
					archiveSummary: evidence.summary,
					dataQuality: message.payload.dataQuality ?? current.dataQuality,
					frontend: message.payload.frontend ?? current.frontend,
					fullHistory: message.payload.fullHistory ?? current.fullHistory,
					scanLogs: message.payload.scanLogs ?? current.scanLogs,
					scanLogsAvailable:
						message.payload.scanLogs !== undefined || current.scanLogsAvailable,
					workers: message.payload.workers ?? current.workers
				};
			});
		});

		return () => {
			window.clearInterval(timer);
			unsubscribe();
		};
	}, []);

	return (
		<>
			<p className="status-stream-notice" role="status">
				{streamState === 'live'
					? 'Live status updates connected.'
					: streamState === 'stale'
						? 'Live status updates are delayed or unavailable. Showing the last received snapshots; timestamps below still apply.'
						: 'Showing initial snapshots; connecting live status updates.'}
			</p>
			<StatusDashboard {...dashboardProps} />
		</>
	);
}
