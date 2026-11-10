'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
	endDeveloperSession, loadDeveloperSession, startDeveloperSignIn,
	type DeveloperSession, type SignInReturn
} from '../../api/developer-verification';
import { isContractAccount } from '../../domain/classic-account';
import { ExplorerContractProvenance } from '../blockchain/explorer-contract-provenance';
import styles from '../blockchain/explorer-entity.module.css';

type View = DeveloperSession | { readonly kind: 'checking' };
type ActionError = 'wrong-origin' | 'busy' | 'unavailable';

export function DeveloperVerificationAccount({ signIn }: { readonly signIn: SignInReturn | null }): React.JSX.Element {
	const [view, setView] = useState<View>({ kind: 'checking' });
	const [attempt, setAttempt] = useState(0);
	const [callback, setCallback] = useState(signIn);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<ActionError | null>(null);
	const action = useRef<AbortController | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		void loadDeveloperSession(controller.signal).then(result => {
			if (!controller.signal.aborted) setView(result);
		});
		return () => controller.abort();
	}, [attempt]);
	useEffect(() => () => action.current?.abort(), []);
	useEffect(() => {
		if (view.kind !== 'signed-in') return;
		const delay = Math.min(Math.max(0, view.expiresAt - Date.now()), 20 * 60_000);
		const timeout = window.setTimeout(() => {
			setCallback(null);
			setView({ kind: 'signed-out' });
		}, delay);
		return () => window.clearTimeout(timeout);
	}, [view]);

	async function changeSession(): Promise<void> {
		if (action.current || (view.kind !== 'signed-out' && view.kind !== 'signed-in')) return;
		const controller = new AbortController();
		action.current = controller;
		setBusy(true);
		setCallback(null);
		setError(null);
		try {
			if (view.kind === 'signed-in') {
				const result = await endDeveloperSession(controller.signal);
				if (controller.signal.aborted) return;
				if (result === 'signed-out') setView({ kind: 'signed-out' });
				else setError(result);
			} else {
				const result = await startDeveloperSignIn(window.location.origin, controller.signal);
				if (controller.signal.aborted) return;
				if (result.kind === 'redirect') {
					window.location.assign(result.url);
					return;
				}
				setError(result.kind);
			}
		} catch {
			if (!controller.signal.aborted) setError('unavailable');
		} finally {
			if (!controller.signal.aborted) {
				action.current = null;
				setBusy(false);
			}
		}
	}

	return (
		<section className={styles.panel} aria-labelledby="developer-account">
			<h2 id="developer-account">Developer account</h2>
			{view.kind === 'checking' && <p role="status">Checking GitHub sign-in…</p>}
			{view.kind === 'disabled' && <p role="status">GitHub sign-in is not enabled.</p>}
			{view.kind === 'unavailable' && (
				<>
					<p role="status">GitHub sign-in is temporarily unavailable.</p>
					<button type="button" onClick={() => {
						setView({ kind: 'checking' });
						setAttempt(current => current + 1);
					}}>Retry session check</button>
				</>
			)}
			{view.kind === 'signed-out' && callback === 'complete' &&
				<p role="status">Your GitHub session could not be confirmed. Sign in again.</p>}
			{view.kind === 'signed-out' && callback === 'rejected' &&
				<p role="status">GitHub sign-in was cancelled or could not be completed.</p>}
			{view.kind === 'signed-out' && callback === 'unavailable' &&
				<p role="status">GitHub sign-in was temporarily unavailable. Try again.</p>}
			{view.kind === 'signed-in' && <p role="status">Signed in with GitHub.</p>}
			{(view.kind === 'signed-out' || view.kind === 'signed-in') &&
				<button type="button" disabled={busy} onClick={() => void changeSession()}>
					{busy ? (view.kind === 'signed-in' ? 'Signing out…' : 'Opening GitHub…')
						: view.kind === 'signed-in' ? 'Sign out' : 'Sign in with GitHub'}
				</button>}
			{error && <p role="alert">{error === 'busy' ? 'Sign-in is busy. Wait one minute before trying again.'
				: error === 'wrong-origin' ? <>Use the <a href="https://stellaratlas.io/developer/verification">main StellarAtlas site</a> to sign in or out.</>
					: 'The request could not be completed. Try again.'}</p>}
			<p>Saved submissions are not available. You can check a public build without signing in.</p>
		</section>
	);
}

export function DeveloperBuildCheck(): React.JSX.Element {
	const [contract, setContract] = useState<string | null>(null);
	const [invalid, setInvalid] = useState(false);

	function selectContract(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const value = new FormData(event.currentTarget).get('contract');
		const address = typeof value === 'string' ? value.trim() : '';
		const valid = isContractAccount(address);
		setInvalid(!valid);
		setContract(valid ? address : null);
	}

	return (
		<section className={styles.panel} aria-labelledby="developer-build">
			<h2 id="developer-build">Check a contract build</h2>
			<form onSubmit={selectContract}>
				<label>Contract address <input name="contract" required maxLength={56} spellCheck={false}
					autoComplete="off" aria-invalid={invalid || undefined}
					aria-describedby={invalid ? 'developer-contract-error' : undefined} /></label>
				{' '}<button type="submit">Open build checker</button>
			</form>
			{invalid && <p id="developer-contract-error" role="alert">Enter a valid Stellar contract address.</p>}
			{contract && <ExplorerContractProvenance key={contract} contractId={contract} />}
		</section>
	);
}
