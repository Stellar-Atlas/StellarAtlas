'use client';

import { Component, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveHealthPill } from '@components/status/status-ui';

interface BoundaryProps {
	readonly children: React.ReactNode;
	readonly isRetrying: boolean;
	readonly onRetry: () => void;
	readonly resetKey: number;
	readonly title: string;
}

interface BoundaryState {
	readonly error: Error | null;
}

class ArchiveEvidenceBoundary extends Component<BoundaryProps, BoundaryState> {
	state: BoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): BoundaryState {
		return { error };
	}

	componentDidUpdate(previous: BoundaryProps): void {
		if (
			previous.resetKey !== this.props.resetKey &&
			this.state.error !== null
		) {
			this.setState({ error: null });
		}
	}

	render(): React.ReactNode {
		if (this.state.error === null) return this.props.children;
		return (
			<article className="panel detail-panel archive-panel known-archive-evidence route-evidence-state failed">
				<div className="panel-heading">
					<h2>{this.props.title}</h2>
					<ArchiveHealthPill state="unknown" />
				</div>
				<p role="alert">The archive evidence request failed.</p>
				<button
					disabled={this.props.isRetrying}
					onClick={this.props.onRetry}
					type="button"
				>
					{this.props.isRetrying ? 'Retrying' : 'Retry'}
				</button>
			</article>
		);
	}
}

export function ArchiveEvidenceErrorBoundary({
	children,
	title
}: {
	readonly children: React.ReactNode;
	readonly title: string;
}): React.JSX.Element {
	const router = useRouter();
	const [resetKey, setResetKey] = useState(0);
	const [isRetrying, startTransition] = useTransition();
	const retry = (): void => {
		startTransition(() => {
			router.refresh();
			setResetKey((value) => value + 1);
		});
	};
	return (
		<ArchiveEvidenceBoundary
			isRetrying={isRetrying}
			onRetry={retry}
			resetKey={resetKey}
			title={title}
		>
			{children}
		</ArchiveEvidenceBoundary>
	);
}
