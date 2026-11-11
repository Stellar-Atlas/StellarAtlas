'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { requestExplorerJson } from '../../api/explorer-analytics';
import { buildTransferActivityPath, parseTransferActivityPage, transferPageSize, type TransferActivityPage, type TransferFilters } from '../../api/transfer-activity';
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
		let path = '';
		void (async () => {
			try {
				path = buildTransferActivityPath(transferRequestFilters(selection), selection.after ?? undefined);
				const page = parseTransferActivityPage(await requestExplorerJson(path, abort.signal), { allowUnrecordedHash: true });
				if (abort.signal.aborted || !sameLocation()) return;
				const limit = transferPageSize(selection.filters.limit)!;
				if (page.limit !== limit || page.transfers.length > limit || (page.nextCursor !== null &&
					(!validTransferCursor(page.nextCursor) || page.nextCursor === selection.after || page.transfers.length === 0)))
					throw new Error('Invalid transfer page or continuation.');
				const windowRange: TransferWindow = [page.watermark.minimumLedger, page.watermark.maximumLedger];
				if (selection.window && selection.window.some((bound, index) => bound !== windowRange[index]))
					throw new Error('The saved transfer ledger window is no longer available.');
				let resultKey = key;
				const request: TransferSelection = { ...selection, window: windowRange,
					boundWindow: selection.after === null ? !!selection.window : selection.boundWindow };
				if (selection.after === null && validTransferWindow(windowRange)) {
					const pinned = transferSelectionHref(pathname, search, request);
					resultKey = JSON.stringify([pinned, attempt]);
					if (resultKey !== key) {
						justPinned.current = resultKey;
						window.history.replaceState(null, '', pinned + window.location.hash);
					}
				}
				setSettled({ key: resultKey, page, error: null, path, request });
			} catch (cause) {
				if (active.current === abort && sameLocation()) {
					const error = abort.signal.aborted ? 'Transfer request canceled.' :
						cause instanceof Error ? cause.message : 'Transfer request failed.';
					setSettled({ key, page: null, error, path, request: selection });
				}
			} finally {
				if (active.current === abort) active.current = null;
			}
		})();
		return () => {
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
		try {
			const target = transferSelectionHref(pathname, search, { filters: draft, after: null });
			previous.current.clear();
			move(target);
		}
		catch (cause) { setActionError({ href, text: cause instanceof Error ? cause.message : 'Invalid transfer filters.' }); }
	};
	const next = current?.page?.nextCursor;
	const prior = previous.current.get(href);
	return {
		href, filters, submit, pageSize: transferPageSize(filters.limit) ?? 25,
		changePageSize: (size: string) => submit({ ...filters, limit: size }),
		page: current?.page ?? null, requestPath: current?.path ?? '',
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
