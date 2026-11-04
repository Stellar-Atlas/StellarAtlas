'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import {
	createContext,
	useContext,
	type ComponentProps,
	type ReactNode
} from 'react';
import {
	sanitizeExplorerReturnTo,
	withExplorerReturnTo
} from '../../api/explorer-return-context';
import styles from './explorer-entity.module.css';

const InvestigationOrigin = createContext<{
	origin: string | null;
	returnTo: string | null;
	pairDetailOrigin?: string | null;
}>({ origin: null, returnTo: null });

export function useExplorerReturnTo(): string | null {
	return useContext(InvestigationOrigin).returnTo;
}

/** A filtered result page can provide its own origin without another back bar. */
export function ExplorerInvestigationScope({
	origin,
	children
}: {
	readonly origin: string;
	readonly children: ReactNode;
}): React.JSX.Element {
	const inherited = useContext(InvestigationOrigin);
	return (
		<InvestigationOrigin.Provider
			value={{
				...inherited,
				origin: sanitizeExplorerReturnTo(origin) ?? inherited.origin
			}}
		>
			{children}
		</InvestigationOrigin.Provider>
	);
}

/** Preserve pair paging for its record details without changing ordinary asset links. */
export function ExplorerPairDetailScope({ origin, children }: {
	readonly origin: string;
	readonly children: ReactNode;
}): React.JSX.Element {
	const inherited = useContext(InvestigationOrigin);
	return <InvestigationOrigin.Provider value={{ ...inherited, pairDetailOrigin: sanitizeExplorerReturnTo(origin) }}>
		{children}
	</InvestigationOrigin.Provider>;
}

/** One URL context per explorer, shared by all linked record components. */
export function ExplorerInvestigation({
	children
}: {
	readonly children: ReactNode;
}): React.JSX.Element {
	const pathname = usePathname();
	const params = useSearchParams();
	const returnTo = sanitizeExplorerReturnTo(params.get('return_to'));
	const returnPath = returnTo ? new URL(returnTo, 'https://explorer.invalid').pathname : '';
	const origin =
		returnTo ??
		sanitizeExplorerReturnTo(
			pathname + (params.size ? '?' + params.toString() : '')
		);
	return (
		<InvestigationOrigin.Provider value={{ origin, returnTo }}>
			{returnTo && (
				<div className={`shell ${styles.returnBar}`}>
					<a href={returnTo}>
						←{' '}
						{returnPath === '/explorer/markets' ? 'Back to pair report'
							: returnPath.split('/').filter(Boolean).length > 2
							? 'Back to investigation'
							: 'Back to results'}
					</a>
				</div>
			)}
			{children}
		</InvestigationOrigin.Provider>
	);
}

/** Detail links keep the original investigation without growing nested URLs. */
export function ExplorerLink({
	href,
	collectionContext = false,
	...props
}: Omit<ComponentProps<'a'>, 'href'> & {
	readonly href: string;
	readonly collectionContext?: boolean;
}): React.JSX.Element {
	const { origin, pairDetailOrigin } = useContext(InvestigationOrigin);
	const pairOrigin = pairDetailOrigin && /^\/explorer\/(?:trades|transactions|operations|liquidity-pools)\/[^/?#]+(?:[?#]|$)/.test(href)
		? pairDetailOrigin : origin;
	return <a {...props} href={withExplorerReturnTo(href, pairOrigin, collectionContext)} />;
}
