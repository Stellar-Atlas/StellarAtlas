'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { withExplorerReturnTo } from '../../api/explorer-return-context';
import {
	ISSUER_DOMAIN_MAX_INPUT, ISSUER_DOMAIN_PATH, issuerDomainHref, normalizeIssuerDomain,
	requestIssuerDomain, type IssuerDomainOutcome
} from '../../api/issuer-domain';
import { ExplorerInvestigationScope } from './explorer-investigation';
import { IssuerDomainResults } from './issuer-domain-results';
import styles from './explorer-issuer-domain.module.css';

const DOMAIN_HELP = 'Enter a DNS hostname, such as example.org. This lookup does not resolve .xlm names.';
type State = IssuerDomainOutcome | { kind: 'loading' } | { kind: 'cancelled' };

export function ExplorerIssuerDomain(): React.JSX.Element {
	const params = useSearchParams();
	const values = params.getAll('domain');
	const raw = values[0] ?? '';
	const domain = values.length === 1 ? normalizeIssuerDomain(raw) : null;
	const [retry, setRetry] = useState(0);
	const [state, setState] = useState<{ domain: string; attempt: number; value: State } | null>(null);
	const active = useRef<AbortController | null>(null);
	const current = state?.domain === domain && state?.attempt === retry ? state.value : null;
	const pending = domain !== null && (!current || current.kind === 'loading');

	useEffect(() => {
		if (!domain) return;
		const controller = new AbortController();
		active.current = controller;
		setState({ domain, attempt: retry, value: { kind: 'loading' } });
		const timeout = window.setTimeout(() => {
			if (controller.signal.aborted) return;
			controller.abort();
			setState({ domain, attempt: retry, value: { kind: 'unavailable' } });
		}, 8000);
		void requestIssuerDomain(domain, controller.signal).then(value => {
			if (controller.signal.aborted) return;
			window.clearTimeout(timeout);
			setState({ domain, attempt: retry, value });
		});
		return () => { window.clearTimeout(timeout); controller.abort(); active.current = null; };
	}, [domain, retry]);

	const cancel = (): void => {
		active.current?.abort();
		if (domain) setState({ domain, attempt: retry, value: { kind: 'cancelled' } });
	};
	return (
		<section className={styles.panel} aria-label="Issuer domain lookup">
			<DomainForm routeKey={params.toString()} initial={raw.slice(0, ISSUER_DOMAIN_MAX_INPUT)}
				invalidRoute={values.length > 0 && !domain}
				onSubmit={next => {
					if (next === domain) setRetry(value => value + 1);
					else {
						active.current?.abort();
						window.history.pushState(null, '', withExplorerReturnTo(issuerDomainHref(next), params.get('return_to')));
					}
				}} />
			{pending && <div className={styles.state}><p role="status">Looking up issuer domain…</p>
				<button type="button" onClick={cancel}>Cancel</button></div>}
			{domain && current?.kind === 'ready' && <ExplorerInvestigationScope origin={issuerDomainHref(domain)}>
				<IssuerDomainResults evidence={current.evidence} />
			</ExplorerInvestigationScope>}
			{current && (current.kind === 'error' || current.kind === 'unavailable' || current.kind === 'cancelled') &&
				<div className={styles.state}>
					<p role={current.kind === 'cancelled' ? 'status' : 'alert'}>{
						current.kind === 'cancelled' ? 'Lookup cancelled.' : current.kind === 'unavailable'
							? 'Issuer domain lookup is temporarily unavailable.' : 'Could not load issuer domain evidence.'
					}</p>
					<button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>
				</div>}
		</section>
	);
}

function DomainForm({ routeKey, initial, invalidRoute, onSubmit }: {
	readonly routeKey: string;
	readonly initial: string;
	readonly invalidRoute: boolean;
	readonly onSubmit: (domain: string) => void;
}): React.JSX.Element {
	const [query, setQuery] = useState(initial);
	const [invalid, setInvalid] = useState(invalidRoute);
	const [previousRoute, setPreviousRoute] = useState(routeKey);
	if (previousRoute !== routeKey) {
		setPreviousRoute(routeKey);
		setQuery(initial);
		setInvalid(invalidRoute);
	}
	return (
		<form className={styles.form} action={ISSUER_DOMAIN_PATH} method="get" onSubmit={event => {
			event.preventDefault();
			const normalized = normalizeIssuerDomain(query);
			if (!normalized) { setInvalid(true); return; }
			setInvalid(false);
			setQuery(normalized);
			onSubmit(normalized);
		}}>
			<label htmlFor="issuer-domain-input">DNS hostname</label>
			<input id="issuer-domain-input" name="domain" value={query} placeholder="example.org"
				maxLength={ISSUER_DOMAIN_MAX_INPUT} autoCapitalize="none" autoCorrect="off" spellCheck={false}
				aria-invalid={invalid || undefined} aria-describedby={invalid ? 'issuer-domain-help issuer-domain-error' : 'issuer-domain-help'}
				onChange={event => { setQuery(event.currentTarget.value); setInvalid(false); }} />
			<button type="submit">Look up domain</button>
			<p id="issuer-domain-help" className={styles.muted}>{DOMAIN_HELP}</p>
			{invalid && <p id="issuer-domain-error" role="alert">Invalid issuer hostname.</p>}
		</form>
	);
}
