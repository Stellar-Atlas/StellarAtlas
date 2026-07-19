'use client';

import { useEffect, useState } from 'react';
import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import { loadArchiveRepairPlan } from '@app/actions/archive-repair-plan';
import { NodeArchiveRepairPlan } from '@components/nodes/node-archive-repair-plan';

type RepairPlanState =
	| { readonly phase: 'idle' }
	| { readonly phase: 'loading' }
	| { readonly message: string; readonly phase: 'failed' }
	| { readonly phase: 'loaded'; readonly plan: PublicHistoryArchiveRepairPlan };

export function ArchiveRepairPlanPanel({
	archiveUrl,
	refreshToken
}: {
	readonly archiveUrl: string | null;
	readonly refreshToken: string;
}): React.JSX.Element {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<RepairPlanState>({ phase: 'idle' });

	useEffect(() => {
		if (archiveUrl === null) {
			setState({ phase: 'idle' });
			return;
		}
		let current = true;
		setState((value) =>
			hasLoadedPlanForArchive(value, archiveUrl) ? value : { phase: 'loading' }
		);
		void loadArchiveRepairPlan(archiveUrl)
			.then((result) => {
				if (!current) return;
				setState((value) =>
					result.status === 'loaded'
						? { phase: 'loaded', plan: result.plan }
						: hasLoadedPlanForArchive(value, archiveUrl)
							? value
							: { message: result.message, phase: 'failed' }
				);
			})
			.catch(() => {
				if (!current) return;
				setState((value) =>
					hasLoadedPlanForArchive(value, archiveUrl)
						? value
						: {
								message: 'Repair evidence is currently unavailable.',
								phase: 'failed'
							}
				);
			});
		return () => {
			current = false;
		};
	}, [archiveUrl, attempt, refreshToken]);

	if (archiveUrl === null) {
		return (
			<p className="muted-inline">
				Select one archive source to inspect its repair evidence.
			</p>
		);
	}
	if (state.phase === 'idle' || state.phase === 'loading') {
		return <p role="status">Loading confirmed repair evidence.</p>;
	}
	if (state.phase === 'failed') {
		return (
			<div className="route-evidence-state unavailable">
				<p role="alert">{state.message}</p>
				<button onClick={() => setAttempt((value) => value + 1)} type="button">
					Retry
				</button>
			</div>
		);
	}
	return <NodeArchiveRepairPlan repairPlan={state.plan} />;
}

function hasLoadedPlanForArchive(
	state: RepairPlanState,
	archiveUrl: string
): state is Extract<RepairPlanState, { readonly phase: 'loaded' }> {
	return state.phase === 'loaded' && state.plan.archiveUrl === archiveUrl;
}
