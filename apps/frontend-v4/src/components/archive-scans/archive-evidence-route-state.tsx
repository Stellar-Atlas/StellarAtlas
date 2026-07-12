'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveHealthPill } from '@components/status/status-ui';

type ArchiveEvidenceRouteState = 'absent' | 'loading' | 'unavailable';

export function ArchiveEvidenceRouteState({
	state,
	title
}: {
	readonly state: ArchiveEvidenceRouteState;
	readonly title: string;
}): React.JSX.Element {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const copy = getStateCopy(state);
	return (
		<article
			aria-busy={state === 'loading'}
			className={`panel detail-panel archive-panel known-archive-evidence route-evidence-state ${state}`}
		>
			<div className="panel-heading">
				<h2>{title}</h2>
				<ArchiveHealthPill state="unknown" />
			</div>
			<p
				role={
					state === 'loading'
						? 'status'
						: state === 'unavailable'
							? 'alert'
							: undefined
				}
			>
				{copy}
			</p>
			{state === 'unavailable' ? (
				<button
					disabled={isPending}
					onClick={() => startTransition(() => router.refresh())}
					type="button"
				>
					{isPending ? 'Retrying' : 'Retry'}
				</button>
			) : null}
		</article>
	);
}

function getStateCopy(state: ArchiveEvidenceRouteState): string {
	if (state === 'loading') return 'Loading current archive evidence.';
	if (state === 'absent')
		return 'No current archive evidence has been recorded.';
	return 'The archive evidence service is currently unavailable.';
}
