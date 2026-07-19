import type { PublicHistoryArchiveObjectEvidenceClass } from '@api/archive-evidence-types';
import type { PublicKnownArchiveEvidence } from '@domain/known-archive-evidence';
import { formatInteger } from '@format/formatters';
import {
	ArchiveSourceFilter,
	CursorPagination,
	EvidenceFilters
} from './known-archive-evidence-controls';
import {
	ArchiveActivityTable,
	ArchiveObjectPageTable,
	ArchiveRootSummaryTable,
	RemoteFailureTable,
	WorkerIssueTable
} from './known-archive-evidence-tables';
import { ArchiveRepairPlanPanel } from './archive-repair-plan-panel';
import type { KnownArchiveEvidenceViewState } from './use-known-archive-evidence';

interface KnownArchiveEvidenceTabContentProps {
	readonly evidence: PublicKnownArchiveEvidence;
	readonly panelId: string;
	readonly tabId: string;
	readonly view: KnownArchiveEvidenceViewState;
}

export function KnownArchiveEvidenceTabContent({
	evidence,
	panelId,
	tabId,
	view
}: KnownArchiveEvidenceTabContentProps): React.JSX.Element {
	return (
		<div
			aria-labelledby={tabId}
			className="known-evidence-tab-panel"
			id={panelId}
			role="tabpanel"
			tabIndex={0}
		>
			{view.tab === 'failures' ? (
				<EvidenceFilters
					archiveUrl={view.failures.archiveUrl}
					disabled={view.failures.isLoading}
					objectType={view.failures.objectType}
					onArchiveUrlChange={view.failures.changeArchiveUrl}
					onObjectTypeChange={view.failures.changeObjectType}
					roots={evidence.roots}
				/>
			) : null}
			{view.tab === 'failures' ? <FailuresView view={view} /> : null}
			{view.tab === 'work' || view.tab === 'verified' ? (
				<ObjectPageView evidence={evidence} view={view} />
			) : null}
			{view.tab === 'repair' ? (
				<RepairView evidence={evidence} view={view} />
			) : null}
			{view.tab === 'summary' ? (
				<ArchiveRootSummaryTable roots={evidence.roots} />
			) : null}
			{view.tab === 'activity' ? (
				<ActivityView evidence={evidence} view={view} />
			) : null}
			{view.tab === 'raw' ? <RawEvidence evidence={evidence} /> : null}
		</div>
	);
}

function FailuresView({
	view
}: {
	readonly view: KnownArchiveEvidenceViewState;
}): React.JSX.Element {
	const failures = view.failures;
	const { remotePage, workerPage } = failures;
	if (remotePage === null || workerPage === null) {
		return (
			<RequestFeedback
				error={failures.error}
				isLoading={failures.isLoading}
				loadingText="Loading remote failures and worker issues."
				onRetry={failures.retry}
			/>
		);
	}

	return (
		<>
			{failures.errorTarget === 'both' ? (
				<RequestFeedback error={failures.error} onRetry={failures.retry} />
			) : failures.isLoading ? (
				<RequestFeedback
					isLoading
					loadingText="Updating archive failure evidence."
				/>
			) : null}
			<section aria-busy={failures.isLoading}>
				<EvidenceSectionHeading
					count={remotePage.total}
					title="Remote archive failures"
					tone="danger"
				/>
				{failures.errorTarget === 'remote' ? (
					<RequestFeedback error={failures.error} onRetry={failures.retry} />
				) : null}
				<RemoteFailureTable page={remotePage} />
				<CursorPagination
					count={remotePage.failures.length}
					disabled={failures.isLoading}
					hasMore={remotePage.hasMore}
					index={failures.remotePageIndex}
					limit={remotePage.limit}
					onNext={failures.nextRemote}
					onPrevious={failures.previousRemote}
					total={remotePage.total}
				/>
			</section>
			<section
				aria-busy={failures.isLoading}
				className="known-evidence-worker-section"
			>
				<EvidenceSectionHeading
					count={workerPage.total}
					title="StellarAtlas worker issues"
					tone="warning"
				/>
				{failures.errorTarget === 'worker' ? (
					<RequestFeedback error={failures.error} onRetry={failures.retry} />
				) : null}
				<WorkerIssueTable page={workerPage} />
				<CursorPagination
					count={workerPage.issues.length}
					disabled={failures.isLoading}
					hasMore={workerPage.hasMore}
					index={failures.workerPageIndex}
					limit={workerPage.limit}
					onNext={failures.nextWorker}
					onPrevious={failures.previousWorker}
					total={workerPage.total}
				/>
			</section>
		</>
	);
}

function ObjectPageView({
	evidence,
	view
}: {
	readonly evidence: PublicKnownArchiveEvidence;
	readonly view: KnownArchiveEvidenceViewState;
}): React.JSX.Element {
	const objects = view.objects;
	const page = objects.page;
	return (
		<>
			{view.tab === 'work' ? (
				<div
					aria-label="Current work status"
					className="segmented known-work-toggle"
				>
					<button
						aria-pressed={objects.status === 'pending'}
						className={objects.status === 'pending' ? 'active' : ''}
						onClick={() => objects.changeStatus('pending')}
						type="button"
					>
						Waiting
					</button>
					<button
						aria-pressed={objects.status === 'scanning'}
						className={objects.status === 'scanning' ? 'active' : ''}
						onClick={() => objects.changeStatus('scanning')}
						type="button"
					>
						Checking
					</button>
				</div>
			) : null}
			<EvidenceFilters
				archiveUrl={objects.archiveUrl}
				disabled={objects.isLoading}
				objectType={objects.objectType}
				onArchiveUrlChange={objects.changeArchiveUrl}
				onObjectTypeChange={objects.changeObjectType}
				roots={evidence.roots}
			/>
			{page === null ? (
				<RequestFeedback
					error={objects.error}
					isLoading={objects.isLoading}
					loadingText="Loading files for the selected status and filters."
					onRetry={objects.retry}
				/>
			) : (
				<div aria-busy={objects.isLoading}>
					<RequestFeedback
						error={objects.error}
						isLoading={objects.isLoading}
						loadingText="Loading the next file page."
						onRetry={objects.retry}
					/>
					<ArchiveObjectPageTable page={page} />
					<CursorPagination
						count={page.objects.length}
						disabled={objects.isLoading}
						hasMore={page.page.hasMore}
						index={objects.pageIndex}
						limit={page.page.limit}
						onNext={objects.next}
						onPrevious={objects.previous}
						total={page.page.total}
					/>
				</div>
			)}
		</>
	);
}

function RepairView({
	evidence,
	view
}: {
	readonly evidence: PublicKnownArchiveEvidence;
	readonly view: KnownArchiveEvidenceViewState;
}): React.JSX.Element {
	const repair = view.repair;
	if (evidence.roots.length === 0) {
		return (
			<p className="known-evidence-empty">
				No archive source is available for repair inspection.
			</p>
		);
	}
	return (
		<>
			{evidence.roots.length > 1 ? (
				<div className="known-evidence-filters">
					<ArchiveSourceFilter
						disabled={false}
						emptyLabel="Select a source"
						onChange={repair.changeArchiveUrl}
						roots={evidence.roots}
						value={repair.archiveUrl}
					/>
				</div>
			) : null}
			<ArchiveRepairPlanPanel
				archiveUrl={repair.archiveUrl}
				refreshToken={evidence.generatedAt}
			/>
		</>
	);
}

function ActivityView({
	evidence,
	view
}: {
	readonly evidence: PublicKnownArchiveEvidence;
	readonly view: KnownArchiveEvidenceViewState;
}): React.JSX.Element {
	const activity = view.activity;
	const page = activity.page;
	return (
		<>
			<div className="known-evidence-activity-filters">
				<EvidenceFilters
					archiveUrl={activity.archiveUrl}
					disabled={activity.isLoading}
					objectType={activity.objectType}
					onArchiveUrlChange={activity.changeArchiveUrl}
					onObjectTypeChange={activity.changeObjectType}
					roots={evidence.roots}
				/>
				<EvidenceClassFilter
					disabled={activity.isLoading}
					onChange={activity.changeEvidenceClass}
					value={activity.evidenceClass}
				/>
			</div>
			{page === null ? (
				<RequestFeedback
					error={activity.error}
					isLoading={activity.isLoading}
					loadingText="Loading activity for the selected filters."
					onRetry={activity.retry}
				/>
			) : (
				<div aria-busy={activity.isLoading}>
					<RequestFeedback
						error={activity.error}
						isLoading={activity.isLoading}
						loadingText="Loading the next activity page."
						onRetry={activity.retry}
					/>
					<ArchiveActivityTable page={page} />
					<CursorPagination
						count={page.events.length}
						disabled={activity.isLoading}
						hasMore={page.page.hasMore}
						index={activity.pageIndex}
						limit={page.page.limit}
						onNext={activity.next}
						onPrevious={activity.previous}
						total={page.page.total}
					/>
				</div>
			)}
		</>
	);
}

function RequestFeedback({
	error = null,
	isLoading = false,
	loadingText = 'Loading archive evidence.',
	onRetry
}: {
	readonly error?: string | null;
	readonly isLoading?: boolean;
	readonly loadingText?: string;
	readonly onRetry?: () => void;
}): React.JSX.Element | null {
	if (error !== null) {
		return (
			<div className="known-evidence-request-state failed" role="alert">
				<span>{error}</span>
				{onRetry ? (
					<button onClick={onRetry} type="button">
						Retry
					</button>
				) : null}
			</div>
		);
	}
	if (!isLoading) return null;
	return (
		<p className="known-evidence-request-state loading" role="status">
			{loadingText}
		</p>
	);
}

function RawEvidence({
	evidence
}: {
	readonly evidence: PublicKnownArchiveEvidence;
}): React.JSX.Element {
	return (
		<details className="metadata-document known-evidence-raw">
			<summary>
				<span>Raw initial route response</span>
				<span className="muted-inline">JSON</span>
			</summary>
			<pre>{JSON.stringify(evidence, null, 2)}</pre>
		</details>
	);
}

function EvidenceSectionHeading({
	count,
	title,
	tone
}: {
	readonly count: number;
	readonly title: string;
	readonly tone: 'danger' | 'warning';
}): React.JSX.Element {
	return (
		<div className={`known-evidence-section-heading ${tone}`}>
			<h3>{title}</h3>
			<span>{formatInteger(count)}</span>
		</div>
	);
}

const evidenceClasses = [
	'archive-object',
	'worker-infrastructure',
	'coordinator-infrastructure'
] as const satisfies readonly PublicHistoryArchiveObjectEvidenceClass[];

function EvidenceClassFilter({
	disabled,
	onChange,
	value
}: {
	readonly disabled: boolean;
	readonly onChange: (
		value: PublicHistoryArchiveObjectEvidenceClass | null
	) => void;
	readonly value: PublicHistoryArchiveObjectEvidenceClass | null;
}): React.JSX.Element {
	return (
		<label className="known-evidence-class-filter">
			<span>Evidence class</span>
			<select
				disabled={disabled}
				onChange={(event) => {
					const selected = evidenceClasses.find(
						(candidate) => candidate === event.target.value
					);
					onChange(selected ?? null);
				}}
				value={value ?? ''}
			>
				<option value="">All classes</option>
				<option value="archive-object">Remote archive</option>
				<option value="worker-infrastructure">Worker infrastructure</option>
				<option value="coordinator-infrastructure">
					Coordinator infrastructure
				</option>
			</select>
		</label>
	);
}
