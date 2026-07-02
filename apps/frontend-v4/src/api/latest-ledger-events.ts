'use client';

export const latestLedgerEventName = 'stellaratlas:latest-ledger';

export interface LatestLedgerEventDetail {
	sequence: string;
}

export const publishLatestLedger = (sequence: string): void => {
	window.dispatchEvent(
		new CustomEvent<LatestLedgerEventDetail>(latestLedgerEventName, {
			detail: { sequence }
		})
	);
};

export const subscribeToLatestLedger = (
	onLedger: (sequence: string) => void
): (() => void) => {
	const handler = (event: Event): void => {
		const customEvent = event as CustomEvent<LatestLedgerEventDetail>;
		const sequence = customEvent.detail?.sequence;
		if (typeof sequence === 'string' && sequence.length > 0) {
			onLedger(sequence);
		}
	};

	window.addEventListener(latestLedgerEventName, handler);
	return () => window.removeEventListener(latestLedgerEventName, handler);
};
