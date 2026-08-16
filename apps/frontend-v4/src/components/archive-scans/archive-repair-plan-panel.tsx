'use client';

import { useEffect, useState } from 'react';
import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import { loadArchiveRepairPlan } from '@app/actions/archive-repair-plan';
import { NodeArchiveRepairPlan } from '@components/nodes/node-archive-repair-plan';
import { ArchivistWholeArchiveOption } from '@components/nodes/node-archive-repair-workflow';

type RepairPlanState =
	| { readonly phase: 'idle' }
	| { readonly phase: 'loading' }
	| { readonly message: string; readonly phase: 'failed' }
	| { readonly phase: 'loaded'; readonly plan: PublicHistoryArchiveRepairPlan };

export function ArchiveRepairPlanPanel({
	archiveUrl
}: {
	readonly archiveUrl: string | null;
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
	}, [archiveUrl, attempt]);

	if (archiveUrl === null) {
		return (
			<RepairPlanFallback>
				<p className="muted-inline">
					Select one archive source to inspect its repair evidence.
				</p>
			</RepairPlanFallback>
		);
	}
	if (state.phase === 'idle' || state.phase === 'loading') {
		return (
			<RepairPlanFallback>
				<p role="status">Loading confirmed repair evidence.</p>
			</RepairPlanFallback>
		);
	}
	if (state.phase === 'failed') {
		return (
			<RepairPlanFallback>
				<div className="route-evidence-state unavailable">
					<p role="alert">{state.message}</p>
					<button
						onClick={() => setAttempt((value) => value + 1)}
						type="button"
					>
						Retry
					</button>
				</div>
			</RepairPlanFallback>
		);
	}
	return <NodeArchiveRepairPlan repairPlan={state.plan} />;
}

function RepairPlanFallback({
	children
}: {
	readonly children: React.ReactNode;
}): React.JSX.Element {
	return (
		<div className="archive-repair-plan">
			{children}
			<ArchivistWholeArchiveOption />
		</div>
	);
}

function hasLoadedPlanForArchive(
	state: RepairPlanState,
	archiveUrl: string
): state is Extract<RepairPlanState, { readonly phase: 'loaded' }> {
	return state.phase === 'loaded' && state.plan.archiveUrl === archiveUrl;
}
