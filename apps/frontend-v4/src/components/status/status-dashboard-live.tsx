'use client';

import { useEffect, useState } from 'react';
import { subscribeToStatusStream } from '@api/status-live-stream';
import { StatusDashboard, type StatusDashboardProps } from './status-dashboard';

function selectFreshArchiveSummary(
	current: StatusDashboardProps['archiveSummary'],
	incoming: StatusDashboardProps['archiveSummary'] | undefined
): StatusDashboardProps['archiveSummary'] {
	if (incoming === undefined) return current;
	const currentTime = Date.parse(current.generatedAt);
	const incomingTime = Date.parse(incoming.generatedAt);
	if (!Number.isFinite(incomingTime)) return current;
	return !Number.isFinite(currentTime) || incomingTime >= currentTime
		? incoming
		: current;
}

export function StatusDashboardLive(
	props: StatusDashboardProps
): React.JSX.Element {
	const [dashboardProps, setDashboardProps] = useState(props);

	useEffect(() => {
		setDashboardProps(props);
	}, [props]);

	useEffect(() => {
		const unsubscribe = subscribeToStatusStream((message) => {
			if (message.type === 'error') return;
			setDashboardProps((current) => ({
				...current,
				api: message.payload.api ?? current.api,
				archiveEvents: message.payload.archiveEvents ?? current.archiveEvents,
				archiveEventsAvailable:
					message.payload.archiveEvents !== undefined ||
					current.archiveEventsAvailable,
				archiveEvidenceAvailable:
					message.payload.archiveSummary !== undefined ||
					current.archiveEvidenceAvailable,
				archiveSummary: selectFreshArchiveSummary(
					current.archiveSummary,
					message.payload.archiveSummary
				),
				dataQuality: message.payload.dataQuality ?? current.dataQuality,
				frontend: message.payload.frontend ?? current.frontend,
				fullHistory: message.payload.fullHistory ?? current.fullHistory,
				scanLogs: message.payload.scanLogs ?? current.scanLogs,
				scanLogsAvailable:
					message.payload.scanLogs !== undefined || current.scanLogsAvailable,
				workers: message.payload.workers ?? current.workers
			}));
		});

		return () => unsubscribe();
	}, []);

	return <StatusDashboard {...dashboardProps} />;
}
