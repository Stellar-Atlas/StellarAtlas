import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicFullHistoryStatus } from '@api/types';
import { parseStatusLiveMessage } from '@api/status-live-stream';
import { createStatusLivePayload } from '../../../api/__tests__/support/status-live-contract-fixtures';
import { CompatibilityIndexPanel } from '../compatibility-index-panel';
import { compatibilityIndexIssueCount } from '../status-dashboard-health';

function history(): PublicFullHistoryStatus {
	const message = parseStatusLiveMessage({
		type: 'status',
		payload: createStatusLivePayload()
	});
	if (message?.type !== 'status') throw new Error('Expected valid fixture');
	return message.payload.fullHistory;
}

function withPromotion(
	state: NonNullable<PublicFullHistoryStatus['canonicalPromotion']>['state']
): PublicFullHistoryStatus {
	const current = history();
	if (current.canonicalPromotion === null)
		throw new Error('Expected promotion fixture');
	return {
		...current,
		canonicalPromotion: { ...current.canonicalPromotion, state }
	};
}

describe('secondary compatibility diagnostics', () => {
	it('keeps three distinct affected components visible while preserving all four detailed records', () => {
		const current = withPromotion('failed');
		if (
			current.canonicalPromotion === null ||
			current.historicalBackfill === null
		)
			throw new Error('Expected fixture');
		const fullHistory: PublicFullHistoryStatus = {
			...current,
			canonicalPromotion: {
				...current.canonicalPromotion,
				lastErrorCode: 'promotion-parsed-projection-missing'
			},
			historicalBackfill: {
				...current.historicalBackfill,
				state: 'failed',
				latestErrorCode: 'database-statement-timeout'
			},
			ledgerCloseMetaState: {
				...current.ledgerCloseMetaState,
				imports: {
					...current.ledgerCloseMetaState.imports,
					lifecycle: {
						...current.ledgerCloseMetaState.imports.lifecycle,
						failed: 633
					}
				}
			}
		};
		const markup = renderToStaticMarkup(
			<CompatibilityIndexPanel fullHistory={fullHistory} />
		);
		expect(compatibilityIndexIssueCount(fullHistory)).toBe(3);
		expect(markup).toContain('<details>');
		expect(markup).not.toContain('<details open');
		const summary = markup.match(/<summary[\s\S]*?<\/summary>/)?.[0];
		expect(summary).toContain('3 components need attention');
		expect(summary).toContain('status-pill warning');
		expect(markup).toContain('633 failed');
		expect(markup).toContain('promotion-parsed-projection-missing');
		expect(markup).toContain('database-statement-timeout');
		for (const label of [
			'Proof-linked canonical index',
			'Account and trustline compatibility index',
			'Compatibility ledger linkage (recorded)',
			'Historical index backfill'
		]) {
			expect(markup.split(label)).toHaveLength(2);
		}
		expect(markup).toContain('do not describe current archive scanner health');
	});

	it('does not count pending/importing/checking records as failed components', () => {
		const current = withPromotion('running');
		const fullHistory: PublicFullHistoryStatus = {
			...current,
			status: 'ok',
			ledgerCloseMetaState: {
				...current.ledgerCloseMetaState,
				imports: {
					...current.ledgerCloseMetaState.imports,
					lifecycle: {
						total: 3,
						complete: 0,
						failed: 0,
						importing: 1,
						pending: 2
					}
				},
				canonicalLinkage: {
					...current.ledgerCloseMetaState.canonicalLinkage,
					lifecycle: {
						total: 3,
						complete: 0,
						failed: 0,
						checking: 0,
						pending: 3
					}
				}
			}
		};
		expect(compatibilityIndexIssueCount(fullHistory)).toBe(0);
		const markup = renderToStaticMarkup(
			<CompatibilityIndexPanel fullHistory={fullHistory} />
		);
		expect(markup).toContain('Recorded queued');
		expect(markup).not.toContain('components need attention');
		expect(markup).toContain(
			'queued records alone do not establish that a worker is running'
		);
	});

	it('shows a healthy wait for the first proof neutrally instead of declaring an outage', () => {
		const fullHistory = {
			...withPromotion('waiting-for-proof'),
			status: 'ok' as const,
			canonicalCoverage: null
		};
		const markup = renderToStaticMarkup(
			<CompatibilityIndexPanel fullHistory={fullHistory} />
		);
		expect(markup).toContain('Awaiting proof');
		expect(markup).toContain('Waiting for proof');
		expect(markup).not.toContain('status-pill danger');
		expect(markup).not.toContain('Telemetry unavailable');
		expect(markup).not.toContain('Sources verified');
	});

	it('preserves a promotion error even when no canonical range has been indexed', () => {
		const current = withPromotion('failed');
		if (current.canonicalPromotion === null)
			throw new Error('Expected promotion fixture');
		const markup = renderToStaticMarkup(
			<CompatibilityIndexPanel
				fullHistory={{
					...current,
					canonicalCoverage: null,
					canonicalPromotion: {
						...current.canonicalPromotion,
						lastErrorCode: 'promotion-parsed-projection-missing'
					}
				}}
			/>
		);
		expect(markup).toContain('1 component needs attention');
		expect(markup).toContain('promotion-parsed-projection-missing');
		expect(markup).toContain('Promotion failed');
	});

	it('keeps a stale promoter visibly unhealthy', () => {
		const markup = renderToStaticMarkup(
			<CompatibilityIndexPanel fullHistory={withPromotion('stale')} />
		);
		expect(markup).toContain('1 component needs attention');
		expect(markup).toContain('Heartbeat stale');
		expect(markup).toContain('status-pill warning');
	});

	it('does not turn unavailable telemetry into a healthy empty state', () => {
		const markup = renderToStaticMarkup(
			<CompatibilityIndexPanel
				fullHistory={{
					...history(),
					status: 'unavailable',
					canonicalCoverage: null,
					canonicalPromotion: null
				}}
			/>
		);
		expect(markup).toContain('Telemetry unavailable');
		expect(markup).toContain('status-pill danger');
		expect(markup).not.toContain('Awaiting proof');
	});
});
