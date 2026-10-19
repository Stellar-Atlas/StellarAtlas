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
}>({ origin: null, returnTo: null });

export function useExplorerReturnTo(): string | null {
	return useContext(InvestigationOrigin).returnTo;
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
						{new URL(returnTo, 'https://explorer.invalid').pathname
							.split('/')
							.filter(Boolean).length > 2
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
	...props
}: Omit<ComponentProps<'a'>, 'href'> & {
	readonly href: string;
}): React.JSX.Element {
	const { origin } = useContext(InvestigationOrigin);
	return <a {...props} href={withExplorerReturnTo(href, origin)} />;
}
