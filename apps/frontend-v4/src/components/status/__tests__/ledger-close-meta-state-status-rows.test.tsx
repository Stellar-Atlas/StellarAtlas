/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import type {
	PublicFullHistoryLedgerCloseMetaStateStatus,
	PublicFullHistoryStatus
} from '@api/types';
import { LedgerCloseMetaStateStatusRows } from '../ledger-close-meta-state-status-rows';

describe('LedgerCloseMetaStateStatusRows', () => {
	it('renders absent imports as neutral progress rather than a platform failure', () => {
		const html = renderToStaticMarkup(
			<LedgerCloseMetaStateStatusRows fullHistory={status(emptyState())} />
		);

		expect(html).toContain('Awaiting decoded state batches');
		expect(html).toContain('Awaiting overlapping proof range');
		expect(html).toContain('status-pill neutral');
		expect(html).not.toContain('Degraded');
	});

	it('does not turn unavailable history telemetry into empty successful records', () => {
		const fullHistory = {
			...status(emptyState()),
			status: 'unavailable' as const
		};
		const html = renderToStaticMarkup(
			<LedgerCloseMetaStateStatusRows fullHistory={fullHistory} />
		);
		expect(html).toContain('Telemetry unavailable');
		expect(html).not.toContain('No account or trustline change batch');
		expect(html).not.toContain('No LedgerCloseMeta batch overlaps');
		expect(html).not.toContain('status-pill good');
	});

	it('identifies old importing records without claiming a live worker', () => {
		const state = populatedState();
		const imports = {
			...state.imports,
			latestUpdatedAt: '2026-08-09T12:00:00.000Z',
			lifecycle: { complete: 0, failed: 0, importing: 3, pending: 0, total: 3 }
		};
		const html = renderToStaticMarkup(
			<LedgerCloseMetaStateStatusRows
				fullHistory={status({ ...state, imports })}
			/>
		);
		expect(html).toContain('Recorded importing');
		expect(html).toContain('Last recorded: 3 importing');
		expect(html).toContain('not live worker status');
		expect(html).toContain('2026-08-09 12:00 UTC');
	});

	it('shows import and proof linkage failures without overstating the proof', () => {
		const state = populatedState();
		const html = renderToStaticMarkup(
			<LedgerCloseMetaStateStatusRows fullHistory={status(state)} />
		);

		expect(html).toContain('3 / 4 imports complete');
		expect(html).toContain('96 / 128 LCM ledgers matched');
		expect(html).toContain('Needs attention');
		expect(html).toContain('proof-gated canonical ledgers');
		expect(html).not.toContain('proof-v6');
		expect(html).toContain('does not verify account/trustline contents');
		expect(html).toContain('or SCP signatures');
	});
});

function status(
	ledgerCloseMetaState: PublicFullHistoryLedgerCloseMetaStateStatus
): PublicFullHistoryStatus {
	return {
		canonicalCoverage: null,
		canonicalPromotion: null,
		earliestParsedLedger: null,
		generatedAt: '2026-07-15T12:00:00.000Z',
		historicalBackfill: null,
		latestObservedAt: null,
		latestParsedLedger: null,
		ledgerCloseMeta: null,
		ledgerCloseMetaState,
		localAssetIndexReady: false,
		localContractIndexReady: false,
		localOperationIndexReady: false,
		localTransactionIndexReady: true,
		mode: 'canonical_checkpoint_index',
		parsedLedgerCount: null,
		sourceArchiveCount: null,
		status: 'ok'
	};
}

function emptyState(): PublicFullHistoryLedgerCloseMetaStateStatus {
	return {
		canonicalLinkage: {
			expectedLedgerCount: '0',
			latestCompletedAt: null,
			latestUpdatedAt: null,
			lifecycle: {
				checking: 0,
				complete: 0,
				failed: 0,
				pending: 0,
				total: 0
			},
			matchedLedgerCount: '0'
		},
		imports: {
			datasets: datasets(0, 0),
			latestCompletedAt: null,
			latestUpdatedAt: null,
			lifecycle: {
				complete: 0,
				failed: 0,
				importing: 0,
				pending: 0,
				total: 0
			}
		}
	};
}

function populatedState(): PublicFullHistoryLedgerCloseMetaStateStatus {
	const updatedAt = '2026-07-15T12:00:00.000Z';
	return {
		canonicalLinkage: {
			expectedLedgerCount: '128',
			latestCompletedAt: updatedAt,
			latestUpdatedAt: updatedAt,
			lifecycle: {
				checking: 0,
				complete: 1,
				failed: 1,
				pending: 0,
				total: 2
			},
			matchedLedgerCount: '96'
		},
		imports: {
			datasets: datasets(3, 1),
			latestCompletedAt: updatedAt,
			latestUpdatedAt: updatedAt,
			lifecycle: {
				complete: 3,
				failed: 1,
				importing: 0,
				pending: 0,
				total: 4
			}
		}
	};
}

function datasets(complete: number, failed: number) {
	return [
		{
			dataset: 'account-state-changes' as const,
			latestCompletedAt: complete > 0 ? '2026-07-15T12:00:00.000Z' : null,
			latestUpdatedAt:
				complete + failed > 0 ? '2026-07-15T12:00:00.000Z' : null,
			lifecycle: {
				complete,
				failed,
				importing: 0,
				pending: 0,
				total: complete + failed
			}
		},
		{
			dataset: 'trustline-state-changes' as const,
			latestCompletedAt: null,
			latestUpdatedAt: null,
			lifecycle: {
				complete: 0,
				failed: 0,
				importing: 0,
				pending: 0,
				total: 0
			}
		}
	];
}
