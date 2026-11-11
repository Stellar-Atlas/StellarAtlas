import { detectAddressPoisoning, addressDifference } from '../address-poisoning';
import type { TransferActivity } from '../../api/transfer-activity';
const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const attacker = 'GAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAADT5AAAAAAAAAAAAAAAAAAWHF';
const payer = 'GAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4LL';
function row(ledger: number, from: string, to: string, amountRaw: string, hash: string): TransferActivity {
	const transactionId = ((BigInt(ledger) << 32n) + 4096n).toString();
	return { id: hash, ledgerSequence: ledger, closedAt: '2026-11-11T00:00:00Z', transactionId,
		operationId: (BigInt(transactionId) + 1n).toString(), transactionHash: hash.repeat(64),
		from, to, toMuxed: null, asset: { id: 'native', type: 'native', code: null, issuer: null },
		contractId: '', eventTopic: 'transfer', amountRaw, amountScale: 7, paymentEvidence: 'mainnet-successful-payment' };
}
export const poisoningRows = [row(100, payer, recipient, '9007199254740993123', 'a'), row(101, attacker, payer, '100000', 'b')];

it('recognizes the successful payment-then-dust sequence independent of display order, preserving every address character', () => {
	const [match] = detectAddressPoisoning(payer, [...poisoningRows].reverse());
	expect(match).toMatchObject({ intendedAddress: recipient, attackingAddress: attacker });
	expect(addressDifference(attacker, recipient).map(part => part.text).join('')).toBe(attacker);
	expect(addressDifference(attacker, recipient).filter(part => part.different).map(part => part.text).join('')).toBe('4DT5');
});
it('does not turn dust alone, unrelated look-alikes, self-payments, unknown or wrong-network evidence into warnings', () => {
	const [payment, dust] = poisoningRows as [TransferActivity, TransferActivity];
	for (const rows of [[dust], [payment], [payment, { ...dust, from: payer }], [payment, { ...dust, from: recipient }],
		[{ ...payment, from: recipient }, dust], [payment, { ...dust, paymentEvidence: null }],
		[{ ...payment, paymentEvidence: undefined }, dust], [payment, { ...dust, paymentEvidence: 'testnet' }],
		[payment, { ...dust, toMuxed: 'M' + 'A'.repeat(68) }], [payment, { ...dust, from: attacker.slice(0, -1) + 'A' }]])
		expect(detectAddressPoisoning(payer, rows as TransferActivity[])).toEqual([]);
	expect(detectAddressPoisoning(recipient, poisoningRows)).toEqual([]);
});
it('enforces exact thresholds and does not interpret arbitrary token decimals as XLM dust', () => {
	const [payment, dust] = poisoningRows as [TransferActivity, TransferActivity];
	for (const change of [{ amountRaw: '100001' }, { amountRaw: '0' }, { amountRaw: '-1' }, { amountScale: null },
		{ asset: { ...dust.asset, id: 'USD:' + recipient, type: 'credit_alphanum4' } }])
		expect(detectAddressPoisoning(payer, [payment, { ...dust, ...change }])).toEqual([]);
	for (const amountRaw of ['5000000', '1'])
		expect(detectAddressPoisoning(payer, [{ ...payment, amountRaw }, dust])).toHaveLength(1);
	for (const amountRaw of ['0', '-1'])
		expect(detectAddressPoisoning(payer, [{ ...payment, amountRaw }, dust])).toEqual([]);
});
it('rejects reversed/same-transaction and forged TOID order; accepts authoritative later transactions within one ledger', () => {
	const [payment, dust] = poisoningRows as [TransferActivity, TransferActivity];
	for (const change of [{ ledgerSequence: 99 }, { transactionHash: payment.transactionHash },
		{ transactionId: payment.transactionId }, { operationId: '1' }, { closedAt: '2026-11-10T00:00:00Z' }])
		expect(detectAddressPoisoning(payer, [payment, { ...dust, ...change }])).toEqual([]);
	const tx = (BigInt(payment.transactionId) + 4096n).toString();
	expect(detectAddressPoisoning(payer, [payment, { ...dust, ledgerSequence: 100, transactionId: tx, operationId: (BigInt(tx) + 1n).toString() }])).toHaveLength(1);
});
