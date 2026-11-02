'use client';
import { useEffect, useRef, useState } from 'react';
import { requestExplorerJson } from '../../api/explorer-analytics';
import { assetDiscoveryKey, assetDiscoveryPath, parseAssetDiscoveryPage, type AssetDiscoveryPage, type AssetDiscoverySelection } from './asset-discovery-page';
interface State { readonly key: string; readonly page: AssetDiscoveryPage | null; readonly error: string | null; readonly busy: boolean }
export function useAssetDiscoveryPage(selection: AssetDiscoverySelection | null) {
	const [attempt, setAttempt] = useState(0), key = (selection ? assetDiscoveryKey(selection) : 'invalid') + ':' + attempt;
	const [state, setState] = useState<State | null>(null);
	const active = useRef<AbortController | null>(null), generation = useRef(0);
	useEffect(() => {
		if (!selection) return;
		const controller = new AbortController(), token = ++generation.current;
		active.current = controller;
		const origin = window.location.pathname + window.location.search;
		const current = () => token === generation.current && !controller.signal.aborted && origin === window.location.pathname + window.location.search;
		setState({ key, page: null, error: null, busy: true });
		void (async () => {
			try {
				const page = parseAssetDiscoveryPage(await requestExplorerJson(assetDiscoveryPath(selection), controller.signal), selection.cursor);
				if (current()) setState({ key, page, error: null, busy: false });
			} catch (failure) {
				if (current()) setState({ key, page: null, error: failure instanceof Error ? failure.message : 'Asset search failed.', busy: false });
			} finally {
				if (token === generation.current && !controller.signal.aborted) {
					active.current = null;
					if (!current()) setState({ key, page: null, error: 'Search context changed. Retry the request.', busy: false });
				}
			}
		})();
		return () => controller.abort();
	}, [key]);
	const cancel = (): void => { generation.current++; active.current?.abort(); active.current = null; setState({ key, page: null, error: 'Asset request cancelled.', busy: false }); };
	const result = state?.key === key ? state : { page: null, error: null, busy: selection !== null };
	return { ...result, cancel, retry: () => setAttempt(value => value + 1) };
}
