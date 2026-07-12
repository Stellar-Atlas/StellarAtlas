'use client';

import { useId, useRef } from 'react';
import { ArchiveHealthPill } from '@components/status/status-ui';
import {
	assessKnownArchiveEvidence,
	knownArchiveEvidenceTabs,
	type PublicKnownArchiveEvidence
} from '@domain/known-archive-evidence';
import type { ArchiveEvidenceSubject } from '@domain/known-archive-evidence-request';
import { formatDateTime, formatInteger } from '@format/formatters';
import { KnownArchiveEvidenceTabContent } from './known-archive-evidence-views';
import { useKnownArchiveEvidence } from './use-known-archive-evidence';

interface KnownArchiveEvidenceProps {
	readonly evidence: PublicKnownArchiveEvidence;
	readonly subject: ArchiveEvidenceSubject;
	readonly title: string;
}

export function KnownArchiveEvidence({
	evidence,
	subject,
	title
}: KnownArchiveEvidenceProps): React.JSX.Element {
	const view = useKnownArchiveEvidence(evidence, subject);
	const liveEvidence = view.evidence;
	const id = useId();
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const activeTabId = `${id}-${view.tab}-tab`;
	const panelId = `${id}-panel`;

	const moveTabFocus = (
		event: React.KeyboardEvent<HTMLButtonElement>,
		index: number
	): void => {
		let nextIndex: number | null = null;
		if (event.key === 'ArrowRight') {
			nextIndex = (index + 1) % knownArchiveEvidenceTabs.length;
		} else if (event.key === 'ArrowLeft') {
			nextIndex =
				(index - 1 + knownArchiveEvidenceTabs.length) %
				knownArchiveEvidenceTabs.length;
		} else if (event.key === 'Home') {
			nextIndex = 0;
		} else if (event.key === 'End') {
			nextIndex = knownArchiveEvidenceTabs.length - 1;
		}
		if (nextIndex === null) return;
		event.preventDefault();
		const nextTab = knownArchiveEvidenceTabs[nextIndex];
		if (nextTab === undefined) return;
		view.selectTab(nextTab.value);
		tabRefs.current[nextIndex]?.focus();
	};

	return (
		<article className="panel detail-panel archive-panel known-archive-evidence">
			<div className="panel-heading known-evidence-heading">
				<div>
					<h2>{title}</h2>
					<span className="muted-inline">
						Updated {formatDateTime(liveEvidence.generatedAt)}
					</span>
				</div>
				<ArchiveHealthPill state={assessKnownArchiveEvidence(liveEvidence)} />
			</div>
			<EvidenceMetrics evidence={liveEvidence} />
			<div
				aria-label="Archive evidence view"
				aria-orientation="horizontal"
				className="archive-health-tabs segmented known-evidence-tabs"
				role="tablist"
			>
				{knownArchiveEvidenceTabs.map((item, index) => (
					<button
						aria-controls={panelId}
						aria-selected={view.tab === item.value}
						className={view.tab === item.value ? 'active' : ''}
						id={`${id}-${item.value}-tab`}
						key={item.value}
						onClick={() => view.selectTab(item.value)}
						onKeyDown={(event) => moveTabFocus(event, index)}
						ref={(element) => {
							tabRefs.current[index] = element;
						}}
						role="tab"
						tabIndex={view.tab === item.value ? 0 : -1}
						type="button"
					>
						{item.label}
						{item.value === 'failures'
							? ` ${formatInteger(liveEvidence.totals.objects.remoteFailureObjects)}`
							: ''}
					</button>
				))}
			</div>
			<KnownArchiveEvidenceTabContent
				evidence={liveEvidence}
				panelId={panelId}
				tabId={activeTabId}
				view={view}
			/>
		</article>
	);
}

function EvidenceMetrics({
	evidence
}: {
	readonly evidence: PublicKnownArchiveEvidence;
}): React.JSX.Element {
	const objects = evidence.totals.objects;
	return (
		<dl className="known-evidence-metrics">
			<Metric
				label="Remote failures"
				tone={objects.remoteFailureObjects > 0 ? 'danger' : 'neutral'}
				value={objects.remoteFailureObjects}
			/>
			<Metric
				label="Worker issues"
				tone={objects.workerIssueObjects > 0 ? 'warning' : 'neutral'}
				value={objects.workerIssueObjects}
			/>
			<Metric label="Checking" tone="neutral" value={objects.activeObjects} />
			<Metric label="Waiting" tone="neutral" value={objects.pendingObjects} />
			<Metric
				label="Files verified"
				tone="good"
				value={`${formatInteger(objects.verifiedObjects)} / ${formatInteger(objects.totalObjects)}`}
			/>
			<Metric
				label="Archive sources"
				tone="neutral"
				value={evidence.totals.archiveRoots}
			/>
		</dl>
	);
}

function Metric({
	label,
	tone,
	value
}: {
	readonly label: string;
	readonly tone: 'danger' | 'good' | 'neutral' | 'warning';
	readonly value: number | string;
}): React.JSX.Element {
	return (
		<div className={tone}>
			<dt>{label}</dt>
			<dd>{typeof value === 'number' ? formatInteger(value) : value}</dd>
		</div>
	);
}
