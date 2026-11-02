'use client';
import { useEffect, useRef, useState } from 'react';
import { requestTransactionTransfers, transactionTransferLocationMatches, type TransactionTransferScope } from '../../api/transaction-transfers';
import type { TransferActivityPage } from '../../api/transfer-activity';

export function useTransactionTransfers(scope: TransactionTransferScope) {
	const [page, setPage] = useState<TransferActivityPage | null>(null);
	const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
	const [activated, setActivated] = useState(false), [after, setAfter] = useState<string | null>(null);
	const [history, setHistory] = useState<(string | null)[]>([]);
	const active = useRef<AbortController | null>(null), revision = useRef(0);
	useEffect(() => () => { revision.current++; active.current?.abort(); }, [scope.hash, scope.ledger]);
	const cancel = (): void => {
		revision.current++; active.current?.abort(); active.current = null;
		setBusy(false); setError('Transfer request cancelled.');
	};
	const load = async (cursor: string | null, previous: (string | null)[]): Promise<void> => {
		active.current?.abort();
		const controller = new AbortController(), token = ++revision.current;
		active.current = controller;
		setActivated(true); setBusy(true); setError(null); setPage(null); setAfter(cursor); setHistory(previous);
		const current = (): boolean => !controller.signal.aborted && token === revision.current &&
			transactionTransferLocationMatches(scope, window.location.pathname, window.location.search);
		try {
			const result = await requestTransactionTransfers(scope, cursor, controller.signal);
			if (current()) setPage(result);
		} catch (failure) {
			if (current()) setError(failure instanceof Error ? failure.message : 'Transfers could not be loaded.');
		} finally {
			if (token === revision.current) {
				active.current = null;
				setBusy(false);
				if (!current() && !controller.signal.aborted) setError('Transaction context changed. Load transfers again.');
			}
		}
	};
	return { page, busy, error, activated, cancel,
		load: () => void load(after, history),
		first: () => void load(null, []),
		previous: history.length ? () => void load(history.at(-1) ?? null, history.slice(0, -1)) : null,
		next: page?.nextCursor && history.length < 50 ? () => void load(page.nextCursor, [...history, after]) : null
	};
}
