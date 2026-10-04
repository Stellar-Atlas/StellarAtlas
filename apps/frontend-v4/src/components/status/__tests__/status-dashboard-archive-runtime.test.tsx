import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicWorkerStatus } from '@api/types';
import { parseStatusLiveMessage } from '@api/status-live-stream';
import {
	createStatusLivePayload,
	generatedAt
} from '../../../api/__tests__/support/status-live-contract-fixtures';
import {
	StatusDashboard,
	type StatusDashboardProps
} from '../status-dashboard';
import { ArchiveHealthPill } from '../status-ui';
import { ArchiveRuntimeStatusPanel } from '../archive-runtime-status-panel';

describe('archive runtime presentation', () => {
	it('shows fresh, healthy active checks in green without claiming verified sources', () => {
		const { headline, runtime } = renderRuntime();
		expect(headline).toContain('stat-card good');
		expect(headline).toContain('2 checks active');
		expect(runtime.match(/status-pill good/g)).toHaveLength(2);
		expect(runtime).toContain('Checking');
		expect(runtime).toContain('Current checks');
		expect(runtime).toContain('runtime health, not archive integrity');
		expect(runtime).not.toContain('Verified');
	});

	it('shows healthy workers awaiting queued checks in green', () => {
		const { headline, runtime } = renderRuntime({ activeWorkers: 0 });
		expect(headline).toContain('stat-card good');
		expect(headline).toContain('Checks queued');
		expect(runtime).toContain('status-pill good');
		expect(runtime).toContain('Waiting');
	});

	it('labels the healthy idle runtime without implying all archives are verified', () => {
		const markup = renderToStaticMarkup(
			<ArchiveRuntimeStatusPanel
				checkedAt={generatedAt}
				detail="No active checks"
				state="verified"
				value="Scanner idle"
			/>
		);
		expect(markup.match(/status-pill good/g)).toHaveLength(2);
		expect(markup).toContain('Idle');
		expect(markup).not.toContain('Verified');
	});

	it.each([
		{ status: 'degraded' as const },
		{ status: 'unavailable' as const },
		{ staleWorkers: 1 },
		{ activeWorkers: 0, configuredWorkerProcesses: 0 }
	])('does not paint an unhealthy runtime green: %p', (workers) => {
		const { headline, runtime } = renderRuntime(workers);
		expect(headline).toContain('stat-card warning');
		expect(runtime).toContain('status-pill warning');
		expect(runtime).toContain('Scanner issue');
		expect(runtime).not.toContain('status-pill good');
	});

	it('keeps absent runtime telemetry unknown rather than healthy', () => {
		const { headline, runtime } = renderRuntime(
			{
				activeWorkers: 0,
				configuredWorkerProcesses: 0,
				lastHeartbeatAt: null,
				registeredWorkers: 0,
				status: 'unavailable'
			},
			false
		);
		expect(headline).toContain('Scanner state unknown');
		expect(headline).not.toContain('stat-card good');
		expect(runtime).toContain('status-pill neutral');
		expect(runtime).toContain('telemetry is unavailable');
		expect(runtime).not.toContain('status-pill good');
	});

	it('does not recolor incomplete archive-source evidence as verified', () => {
		for (const state of ['checking', 'waiting', 'scanner_issue'] as const) {
			const markup = renderToStaticMarkup(<ArchiveHealthPill state={state} />);
			expect(markup).toContain('status-pill warning');
		}
		expect(
			renderToStaticMarkup(<ArchiveHealthPill state="integrity_failure" />)
		).toContain('status-pill danger');
	});

	it('keeps compatibility-index failures visible alongside healthy workers', () => {
		const props = statusProps();
		const promotion = props.fullHistory.canonicalPromotion;
		if (promotion === null) throw new Error('Expected promotion fixture');
		const markup = renderToStaticMarkup(
			<StatusDashboard
				{...props}
				fullHistory={{
					...props.fullHistory,
					canonicalPromotion: { ...promotion, state: 'failed' }
				}}
			/>
		);
		const indexes = section(markup, 'Compatibility indexes');
		expect(indexes).toContain('status-pill warning');
		expect(indexes).toContain('Promotion failed');
		expect(section(markup, 'Archive verification runtime')).toContain(
			'status-pill good'
		);
	});
});

function renderRuntime(
	workers: Partial<PublicWorkerStatus['archiveWorkers']> = {},
	archiveEvidenceAvailable = true
) {
	const props = statusProps();
	const markup = renderToStaticMarkup(
		<StatusDashboard
			{...props}
			archiveEvidenceAvailable={archiveEvidenceAvailable}
			workers={{
				...props.workers,
				archiveWorkers: { ...props.workers.archiveWorkers, ...workers }
			}}
		/>
	);
	const headline = markup.match(
		/<article class="stat-card[^"]*"><span>Archive verification runtime<\/span>[\s\S]*?<\/article>/
	)?.[0];
	if (headline === undefined) throw new Error('Expected runtime headline');
	return { headline, runtime: section(markup, 'Archive verification runtime') };
}

function section(markup: string, label: string): string {
	const result = markup.match(
		new RegExp(`<section[^>]*aria-label="${label}"[\\s\\S]*?<\\/section>`)
	)?.[0];
	if (result === undefined) throw new Error(`Expected ${label} section`);
	return result;
}

function statusProps(): StatusDashboardProps {
	const message = parseStatusLiveMessage({
		payload: createStatusLivePayload(),
		type: 'status'
	});
	if (message?.type !== 'status') throw new Error('Expected status fixture');
	return {
		...message.payload,
		archiveEvidenceAvailable: true,
		archiveEventsAvailable: true,
		archiveObjects: {
			activeObjects: 0,
			failedObjects: 0,
			generatedAt,
			objects: [],
			pendingObjects: 0,
			verifiedObjects: 0
		},
		archiveObjectsAvailable: false,
		scanLogsAvailable: true,
		workers: {
			...message.payload.workers,
			archiveWorkers: {
				...message.payload.workers.archiveWorkers,
				activeWorkers: 2,
				configuredWorkerProcesses: 4,
				lastHeartbeatAt: generatedAt,
				registeredWorkers: 4,
				staleWorkers: 0,
				status: 'ok'
			}
		}
	};
}
