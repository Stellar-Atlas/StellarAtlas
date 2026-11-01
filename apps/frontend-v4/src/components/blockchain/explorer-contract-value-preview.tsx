import type { ContractEventValue } from '../../domain/contract-event-value';
import { contractEventText } from '../../domain/contract-event-summary';
import { LeafValue, StateKey } from './explorer-contract-state-values';
import styles from './explorer-contract-state-change-table.module.css';

function untyped(value: ContractEventValue): ContractEventValue {
	return value.kind === 'typed' ? untyped(value.value) : value;
}

function containerText(value: ContractEventValue): string {
	value = untyped(value);
	if (value.kind === 'object') return value.entries.length ? `${value.entries.length} ${value.entries.length === 1 ? 'field' : 'fields'}` : 'Empty map';
	if (value.kind === 'array') {
		if (!value.items.length) return 'Empty list';
		const records = value.items.every(item => untyped(item).kind === 'object');
		return `${value.items.length} ${records ? value.items.length === 1 ? 'record' : 'records' : value.items.length === 1 ? 'item' : 'items'}`;
	}
	return '';
}

/** Bounded previews describe omitted structure, never shorten an address. */
export function ContractValuePreview({ value, ledger, kind = 'value' }: {
	readonly value: ContractEventValue;
	readonly ledger: string;
	readonly kind?: 'key' | 'value';
}): React.JSX.Element {
	const plain = untyped(value);
	if (kind === 'key' && plain.kind === 'array' && plain.items.length <= 3 &&
		plain.items.every(item => ['string', 'number', 'boolean'].includes(untyped(item).kind)) &&
		plain.items.map(contractEventText).join(' / ').length <= 56) {
		return <StateKey value={value} ledger={ledger} />;
	}
	if (plain.kind === 'object' || plain.kind === 'array') {
		const first = plain.kind === 'object' ? plain.entries[0] : undefined;
		const name = first ? (first.key ? contractEventText(first.key) : first.label).replaceAll('_', ' ') : '';
		const nested = first ? containerText(first.value) : '';
		return <span className={styles.preview}>
			<strong>{name && name.length <= 40 && nested ? `${name} · ${nested}` : containerText(plain)}</strong>
			{plain.kind === 'object' && plain.entries.length > 1 && <span className={styles.muted}>{plain.entries.length - (nested ? 1 : 0)} {nested ? 'other fields' : 'fields'} · open details</span>}
		</span>;
	}
	if (plain.kind === 'raw') return <span className={styles.muted}>{plain.reason === 'limit-exceeded' ? 'Complex value · open details' : 'Unrecognized value · open details'}</span>;
	const text = contractEventText(plain);
	if (/^-?\d+$/.test(text) && text.replace('-', '').length > 48) {
		return <span className={styles.muted}>Integer · {text.replace('-', '').length} digits</span>;
	}
	if ((plain.kind === 'string' || plain.kind === 'bytes') && text.length > 60) {
		return <span className={styles.muted}>{plain.kind === 'bytes' ? 'Decoded text' : 'Text'} · {text.length.toLocaleString('en-US')} characters</span>;
	}
	return <span className={styles.scalarPreview}><LeafValue value={value} field="" ledger={ledger} /></span>;
}
