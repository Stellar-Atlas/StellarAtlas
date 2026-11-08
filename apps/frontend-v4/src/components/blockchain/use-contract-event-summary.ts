'use client';

import { useEffect, useRef, useState } from 'react';
import { contractActivityPath, requestContractActivity, type ContractActivityPage } from '../../api/explorer-contract-activity';
import type { ExplorerFilters } from '../../api/explorer-analytics';

/** Explicit aggregation only; ordinary row requests and cursor pages never start it. */
export function useContractEventSummary(contractId: string, filters: ExplorerFilters, key: string, enabled: boolean) {
	const active = useRef<AbortController | null>(null);
	const [result, setResult] = useState<{ key: string; value?: ContractActivityPage['summary']; loading: boolean; error?: string }>();
	useEffect(() => () => { active.current?.abort(); active.current = null; }, [key, enabled]);
	const load = () => {
		if (!enabled || active.current) return;
		const abort = new AbortController();
		active.current = abort;
		setResult(previous => ({ key, value: previous?.key === key ? previous.value : undefined, loading: true }));
		const position = filters.after ?? '';
		const path = contractActivityPath(contractId, 'events', { ...filters, limit: '1' }, position, true);
		void requestContractActivity(path, contractId, 'events', position, abort.signal).then(page => {
			if (!page.summary) throw new Error('Totals were not reported.');
			if (!abort.signal.aborted) setResult({ key, value: page.summary, loading: false });
		}).catch((failure: unknown) => {
			if (!abort.signal.aborted) setResult(previous => ({ key, value: previous?.key === key ? previous.value : undefined,
				loading: false, error: failure instanceof Error ? failure.message : 'Totals unavailable.' }));
		}).finally(() => { if (active.current === abort) active.current = null; });
	};
	return { summary: result?.key === key ? result.value : undefined,
		loading: result?.key === key && result.loading && active.current !== null,
		error: result?.key === key ? result.error : undefined, load };
}
