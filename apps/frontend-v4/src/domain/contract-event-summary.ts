import type { ContractEventValue } from './contract-event-value';

const diagnosticTitles = new Map([
	['fn_call', 'Function call'],
	['fn_return', 'Function return'],
	['core_metrics', 'Runtime metric']
]);

export function contractEventText(value: ContractEventValue): string {
	if (value.kind === 'typed') return contractEventText(value.value);
	return value.kind === 'string' ||
		value.kind === 'number' ||
		value.kind === 'boolean'
		? String(value.value)
		: '';
}

/** Display source topics, without inferring a call graph or contract-specific semantics. */
export function summarizeContractEvent(
	kind: string,
	topics: readonly ContractEventValue[]
): { readonly title: string; readonly context: string } {
	const first = topics[0] ? contractEventText(topics[0]) : '';
	const kindLabel =
		kind === 'diagnostic'
			? 'Diagnostic'
			: kind === 'contract'
				? 'Contract'
				: 'Event';
	const context = topics.slice(1).flatMap((topic) => {
		if (
			topic.kind === 'typed' &&
			!['symbol', 'string'].includes(topic.typeName)
		)
			return [];
		let leaf = topic;
		while (leaf.kind === 'typed') leaf = leaf.value;
		if (leaf.kind !== 'string') return [];
		const text = contractEventText(topic);
		// References remain complete, linked values in Details, not clipped labels.
		if (
			!text ||
			text.length > 96 ||
			/[\u0000-\u001f\u007f]/.test(text) ||
			/^(?:[GC][A-Z2-7]{55}|[^:]{1,12}:G[A-Z2-7]{55})$/.test(text)
		)
			return [];
		return [text];
	})[0];
	return {
		title:
			(kind === 'diagnostic' ? diagnosticTitles.get(first) : undefined) ??
			(first || 'Event'),
		context: context
			? `${kindLabel} · ${context}`
			: `${kindLabel} · ${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}`
	};
}

export function contractEventOutcome(successful: unknown): {
	readonly mark: string;
	readonly label: string;
} {
	if (successful === true) return { mark: '✓', label: 'Transaction succeeded' };
	if (successful === false) return { mark: '!', label: 'Transaction failed' };
	return { mark: '—', label: 'Transaction result not recorded' };
}
