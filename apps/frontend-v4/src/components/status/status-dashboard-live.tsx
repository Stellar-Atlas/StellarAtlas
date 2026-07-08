'use client';

import { useEffect, useState } from 'react';
import { subscribeToStatusStream } from '@api/status-live-stream';
import {
	StatusDashboard,
	type StatusDashboardProps
} from './status-dashboard';

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
				if (message.type !== 'status') return;
				setDashboardProps((current) => ({
					...current,
					api: message.payload.api,
					archiveEvents: message.payload.archiveEvents,
					archiveEvidenceAvailable: true,
					archiveSummary: message.payload.archiveSummary,
					dataQuality: message.payload.dataQuality,
					frontend: message.payload.frontend,
					scanLogs: message.payload.scanLogs,
					workers: message.payload.workers
				}));
			}),
		[]
	);

	return <StatusDashboard {...dashboardProps} />;
}
