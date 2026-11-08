import { recordValue, type EntityRecord } from '../../api/explorer-analytics';
import { isClassicAccount, isContractAccount } from '../../domain/classic-account';
import { contractEventText } from '../../domain/contract-event-summary';
import type { ContractEventValue } from '../../domain/contract-event-value';

export interface EventTokenContext {
	readonly contractId: string;
	readonly assetId: string;
	readonly symbol: string;
	readonly decimals: number;
}

/** API context is attached only after SDK SAC derivation; an asset page can also supply its resolved identity. */
export function tokenEventAmount(row: EntityRecord, value: ContractEventValue, topics: readonly ContractEventValue[], supplied?: EventTokenContext) {
	const context = supplied ?? recordValue(row.tokenContext);
	const { contractId, assetId, symbol, decimals } = context;
	if (typeof contractId !== 'string' || !isContractAccount(contractId) || contractId !== row.contractId ||
		typeof assetId !== 'string' || typeof symbol !== 'string' || decimals !== 7) return null;
	const parts = assetId.split(':');
	if (!(assetId === 'native' && symbol === 'XLM') &&
		!(parts.length === 2 && /^[a-zA-Z0-9]{1,12}$/.test(parts[0]!) && parts[0] === symbol && isClassicAccount(parts[1]!))) return null;
	const topic = topics[0] ? contractEventText(topics[0]) : '';
	if (!['mint', 'burn', 'transfer', 'clawback'].includes(topic)) return null;
	const amount = value.kind === 'object' ? value.entries.find(field => field.label === 'amount')?.value : value;
	if (amount?.kind !== 'typed' || amount.typeName !== 'i128') return null;
	const raw = contractEventText(amount.value);
	if (!/^(?:0|-?[1-9]\d{0,38})$/.test(raw) || BigInt(raw) < -(1n << 127n) || BigInt(raw) >= 1n << 127n) return null;
	return { token: { contractId: String(contractId), assetId, symbol, decimals }, raw, topic };
}

export function tokenEventTopicLabels(topic: string, count: number): readonly string[] {
	if (topic === 'transfer' && count === 4) return ['Event', 'Sender', 'Recipient', 'Asset'];
	if (count === 3 && ['mint', 'burn', 'clawback'].includes(topic))
		return ['Event', topic === 'mint' ? 'Recipient' : 'Sender', 'Asset'];
	return [];
}
