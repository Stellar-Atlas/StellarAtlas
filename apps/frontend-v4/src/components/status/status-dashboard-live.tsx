'use client';

import { useEffect, useState } from 'react';
import { subscribeToStatusStream } from '@api/status-live-stream';
import { StatusDashboard, type StatusDashboardProps } from './status-dashboard';

export function StatusDashboardLive(
	props: StatusDashboardProps
): React.JSX.Element {
	const [dashboardProps, setDashboardProps] = useState(props);

	useEffect(() => {
		setDashboardProps(props);
	}, [props]);

	useEffect(
		() =>
			subscribeToStatusStream((message) => {
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
					archiveSummary:
						message.payload.archiveSummary ?? current.archiveSummary,
					dataQuality: message.payload.dataQuality ?? current.dataQuality,
					frontend: message.payload.frontend ?? current.frontend,
					scanLogs: message.payload.scanLogs ?? current.scanLogs,
					scanLogsAvailable:
						message.payload.scanLogs !== undefined || current.scanLogsAvailable,
					workers: message.payload.workers ?? current.workers
				}));
			}),
		[]
	);

	return <StatusDashboard {...dashboardProps} />;
}
