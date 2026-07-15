export const emptyLedgerCloseMetaState = {
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
		datasets: [
			{
				dataset: 'account-state-changes',
				latestCompletedAt: null,
				latestUpdatedAt: null,
				lifecycle: {
					complete: 0,
					failed: 0,
					importing: 0,
					pending: 0,
					total: 0
				}
			},
			{
				dataset: 'trustline-state-changes',
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
		],
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
} as const;

export const mixedStateImportRows = [
	{
		complete: '1',
		dataset: 'account-state-changes',
		failed: '1',
		importing: '0',
		latestCompletedAt: '2026-07-06T11:58:00.000Z',
		latestUpdatedAt: '2026-07-06T11:59:30.000Z',
		pending: '1',
		total: '3'
	}
] as const;

export const mixedCanonicalLinkageRows = [
	{
		checking: '1',
		complete: '1',
		expectedLedgerCount: '256',
		failed: '1',
		latestCompletedAt: '2026-07-06T11:58:30.000Z',
		latestUpdatedAt: '2026-07-06T11:59:40.000Z',
		matchedLedgerCount: '96',
		pending: '1',
		total: '4'
	}
] as const;
