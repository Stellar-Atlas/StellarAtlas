import type { TransferActivity } from '../api/transfer-activity';
import { isClassicAccount } from './classic-account';

export interface AddressPoisoningMatch {
	readonly intendedAddress: string;
	readonly attackingAddress: string;
	readonly payment: TransferActivity;
	readonly dust: TransferActivity;
}
export const poisoningRule = { prefix: 5, suffix: 4, dustMaximumRaw: 100_000n } as const;

/** Only the explicitly loaded mainnet account page. No history fetch or balance inference. */
export function detectAddressPoisoning(account: string, rows: readonly TransferActivity[]): readonly AddressPoisoningMatch[] {
	if (!isClassicAccount(account) || rows.length > 100) return [];
	const eligible = rows.filter(row => row.paymentEvidence === 'mainnet-successful-payment' && row.eventTopic === 'transfer' &&
		row.amountScale === 7 && row.toMuxed === null && isClassicAccount(row.from ?? '') && isClassicAccount(row.to ?? '') &&
		row.from !== row.to && /^[1-9][0-9]{0,18}$/.test(row.amountRaw) &&
		/^[a-f0-9]{64}$/.test(row.transactionHash) && validPosition(row));
	const outgoing = eligible.filter(row => row.from === account);
	const matches = new Map<string, AddressPoisoningMatch>();
	for (const dust of eligible) {
		if (dust.to !== account || BigInt(dust.amountRaw) > poisoningRule.dustMaximumRaw) continue;
		const attackingAddress = dust.from!;
		const payment = outgoing.filter(row => {
			const recipient = row.to!;
			return recipient !== attackingAddress && recipient !== account &&
				recipient.slice(0, poisoningRule.prefix) === attackingAddress.slice(0, poisoningRule.prefix) &&
				recipient.slice(-poisoningRule.suffix) === attackingAddress.slice(-poisoningRule.suffix) && earlier(row, dust);
		}).sort((a, b) => a.ledgerSequence - b.ledgerSequence || (BigInt(a.transactionId) < BigInt(b.transactionId) ? -1 : 1)).at(-1);
		// Dust is native XLM only: do not apply decimal-only thresholds to arbitrary token value.
		if (payment && dust.asset.id === 'native' && dust.asset.type === 'native')
			matches.set(attackingAddress, { intendedAddress: payment.to!, attackingAddress, payment, dust });
	}
	return [...matches.values()];
}
function validPosition(row: TransferActivity): boolean {
	if (!Number.isSafeInteger(row.ledgerSequence) || row.ledgerSequence < 1 ||
		!/^[1-9][0-9]{0,18}$/.test(row.transactionId) || !/^[1-9][0-9]{0,18}$/.test(row.operationId ?? '')) return false;
	const id = BigInt(row.transactionId), op = BigInt(row.operationId!);
	return (id >> 32n) === BigInt(row.ledgerSequence) && id % 4096n === 0n && (id & 0xffffffffn) >= 4096n &&
		op > id && op <= id + 100n && Number.isFinite(Date.parse(row.closedAt));
}
function earlier(payment: TransferActivity, dust: TransferActivity): boolean {
	if (payment.transactionHash === dust.transactionHash || Date.parse(payment.closedAt) > Date.parse(dust.closedAt)) return false;
	return payment.ledgerSequence < dust.ledgerSequence || (payment.ledgerSequence === dust.ledgerSequence &&
		Date.parse(payment.closedAt) === Date.parse(dust.closedAt) && BigInt(payment.transactionId) < BigInt(dust.transactionId));
}

export function addressDifference(address: string, comparison: string): readonly { text: string; different: boolean }[] {
	const groups: { text: string; different: boolean }[] = [];
	for (let i = 0; i < address.length; i++) {
		const different = address[i] !== comparison[i], last = groups.at(-1);
		if (last?.different === different) last.text += address[i];
		else groups.push({ text: address[i]!, different });
	}
	return groups;
}
