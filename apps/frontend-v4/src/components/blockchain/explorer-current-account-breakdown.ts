import type { CurrentBalance } from '../../api/explorer-current-account';
import type { CurrentAccountSnapshot, NativeReserveEvidence } from '../../api/explorer-current-account-snapshot';

export function nativeMinimumReserve(evidence: NativeReserveEvidence): bigint | null {
	const { latestLedger, baseReserveLedger, baseReserve, subentries, sponsoring, sponsored } = evidence;
	if (latestLedger === null || latestLedger !== baseReserveLedger ||
		baseReserve === null || subentries === null || sponsoring === null || sponsored === null ||
		[baseReserve, subentries, sponsoring, sponsored].some(value => value < 0n || value > 0xffff_ffffn)) return null;
	const units = 2n + subentries + sponsoring - sponsored;
	return units < 0n ? null : units * baseReserve;
}

const positive = (value: bigint) => value < 0n ? 0n : value;

/** Only derive values supported by the same exact account response and ledger. */
export function currentAccountBreakdown(row: CurrentBalance, snapshot: CurrentAccountSnapshot) {
	const bound = snapshot.latestLedger !== null;
	const selling = row.kind === 'pool' || !bound ? null : row.selling;
	const minimumReserve = row.kind === 'native' && snapshot.inventoryComplete ? nativeMinimumReserve(snapshot) : null;
	const heldForReserve = minimumReserve === null ? null : row.balance - positive(row.balance - minimumReserve);
	const afterReserve = row.balance - (heldForReserve ?? 0n);
	const heldForOffers = selling === null ? null : afterReserve - positive(afterReserve - selling);
	const offerShortfall = selling === null ? null : positive(selling - afterReserve);
	const authorizedCredit = row.kind === 'credit' && row.authorization === 'authorized';
	const available = (authorizedCredit || minimumReserve !== null) && heldForOffers !== null ? afterReserve - heldForOffers : null;
	const rawHeadroom = bound && authorizedCredit && row.limit !== null && row.buying !== null
		? row.limit - row.balance - row.buying : null;
	return {
		available,
		minimumReserve,
		heldForReserve,
		reserveShortfall: minimumReserve === null ? null : positive(minimumReserve - row.balance),
		heldForOffers,
		offerShortfall,
		receiveHeadroom: rawHeadroom === null ? null : positive(rawHeadroom)
	};
}
