'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { requestExplorerJson } from '../../api/explorer-analytics';
import { buildTransferActivityPath, parseTransferActivityPage, type TransferActivityPage, type TransferFilters } from '../../api/transfer-activity';
import { readTransferSelection, transferRequestFilters, transferSelectionHref, validTransferCursor, validTransferWindow, type TransferSelection, type TransferWindow } from './transfer-investigation-route';

type RequestResult = {
	key: string;
	path: string;
	error: string | null;
	page: TransferActivityPage | null;
	request: TransferSelection;
};

export function useTransferInvestigation() {
	const pathname = usePathname();
	const search = useSearchParams().toString();
	const href = pathname + (search ? '?' + search : '');
	const { filters, selection, error: routeError } = readTransferSelection(new URLSearchParams(search));
	const [attempt, setAttempt] = useState(0);
	const [settled, setSettled] = useState<RequestResult | null>(null);
	const [actionError, setActionError] = useState<{ href: string; text: string } | null>(null);
	const active = useRef<AbortController | null>(null);
	const justPinned = useRef<string | null>(null);
	const previous = useRef(new Map<string, string>());
	const key = JSON.stringify([href, attempt]);
	useEffect(() => {
		if (justPinned.current === key) {
			justPinned.current = null;
			return;
		}
		if (!selection) return;
		const abort = new AbortController();
		active.current = abort;
		const start = window.location.pathname + window.location.search;
		const sameLocation = () => start === window.location.pathname + window.location.search;
		const timeout = setTimeout(() => abort.abort(), 20_000);
		let path = '';
		void (async () => {
			try {
				path = buildTransferActivityPath(transferRequestFilters(selection), selection.after ?? undefined);
				const page = parseTransferActivityPage(await requestExplorerJson(path, abort.signal), { allowUnrecordedHash: true });
				if (abort.signal.aborted || !sameLocation()) return;
				if (page.limit !== 10 || page.transfers.length > 10 || (page.nextCursor !== null &&
					(!validTransferCursor(page.nextCursor) || page.nextCursor === selection.after || page.transfers.length === 0)))
					throw new Error('Invalid transfer page or continuation.');
				const windowRange: TransferWindow = [page.watermark.minimumLedger, page.watermark.maximumLedger];
				if (selection.window && selection.window.some((bound, index) => bound !== windowRange[index]))
					throw new Error('The saved transfer ledger window is no longer available.');
				let resultKey = key;
				if (selection.after === null && !selection.window && validTransferWindow(windowRange)) {
					const pinned = transferSelectionHref(pathname, search, { ...selection, window: windowRange });
					resultKey = JSON.stringify([pinned, attempt]);
					justPinned.current = resultKey;
					window.history.replaceState(null, '', pinned + window.location.hash);
				}
				setSettled({ key: resultKey, page, error: null, path, request: selection });
			} catch (cause) {
				if (active.current === abort && sameLocation()) {
					const error = abort.signal.aborted ? 'Transfer request canceled or timed out.' :
						cause instanceof Error ? cause.message : 'Transfer request failed.';
					setSettled({ key, page: null, error, path, request: selection });
				}
			} finally {
				clearTimeout(timeout);
				if (active.current === abort) active.current = null;
			}
		})();
		return () => {
			clearTimeout(timeout);
			if (active.current === abort) active.current = null;
			abort.abort();
		};
	}, [key]);

	const current = settled?.key === key ? settled : null;
	const move = (target: string) => {
		active.current?.abort();
		setActionError(null);
		if (target === href) setAttempt(value => value + 1);
		else window.history.pushState(null, '', target + window.location.hash);
	};
	const submit = (draft: TransferFilters) => {
		try { move(transferSelectionHref(pathname, search, { filters: draft, after: null })); }
		catch (cause) { setActionError({ href, text: cause instanceof Error ? cause.message : 'Invalid transfer filters.' }); }
	};
	const next = current?.page?.nextCursor;
	const prior = previous.current.get(href);
	return {
		href, filters, submit, page: current?.page ?? null, requestPath: current?.path ?? '',
		busy: selection !== null && current === null,
		error: routeError ?? (actionError?.href === href ? actionError.text : null) ?? current?.error,
		retry: current?.error ? () => move(href) : null,
		cancel: () => active.current?.abort(),
		previous: prior ? () => move(prior) : null,
		next: current && next ? () => {
			try {
				// The API binds its cursor to the exact filters that produced it.
				const target = transferSelectionHref(pathname, search, { ...current.request, after: next });
				previous.current.set(target, href);
				const oldest = previous.current.keys().next().value;
				if (previous.current.size > 50 && oldest) previous.current.delete(oldest);
				move(target);
			} catch (cause) { setActionError({ href, text: cause instanceof Error ? cause.message : 'Invalid continuation.' }); }
		} : null
	};
}
