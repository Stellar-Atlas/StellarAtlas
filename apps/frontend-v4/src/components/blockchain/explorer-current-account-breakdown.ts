import type { CurrentBalance } from '../../api/explorer-current-account';

/** Only derive values supported by the same exact response. Native reserve needs separate matched evidence. */
export function currentAccountBreakdown(row: CurrentBalance) {
	const selling = row.kind === 'pool' ? null : row.selling;
	const heldForOffers = selling === null ? null : selling > row.balance ? row.balance : selling;
	const offerShortfall = selling === null ? null : selling > row.balance ? selling - row.balance : 0n;
	const authorizedCredit = row.kind === 'credit' && row.authorization === 'authorized';
	const available = authorizedCredit && heldForOffers !== null ? row.balance - heldForOffers : null;
	const rawHeadroom = authorizedCredit && row.limit !== null && row.buying !== null
		? row.limit - row.balance - row.buying : null;
	return {
		available,
		heldForOffers,
		offerShortfall,
		receiveHeadroom: rawHeadroom === null ? null : rawHeadroom < 0n ? 0n : rawHeadroom
	};
}
