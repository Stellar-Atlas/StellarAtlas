'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DeveloperSession } from '../../api/developer-verification';
import {
	loadSubmissionCapability, readDeveloperSubmission, saveDeveloperSubmission, submissionInput,
	type SavedSubmission, type SubmissionCapability, type SubmissionError, type SubmissionInput, type SubmissionResponse
} from '../../api/developer-submissions';
import { DeveloperSubmissionResult } from './developer-submission-result';
import styles from './developer-submissions.module.css';

type Attempt = { readonly key: string; readonly input: SubmissionInput };
type Session = DeveloperSession | { readonly kind: 'checking' };
const messages: Record<SubmissionError['kind'], string> = {
	unavailable: 'The request could not be confirmed. Retry with the same request key.',
	disabled: 'Saved verification requests are not enabled.',
	'signed-out': 'Your GitHub session has expired. Sign in again.',
	'wrong-origin': 'Use the main StellarAtlas site to save a request.',
	invalid: 'Enter a valid contract address, owner/repo and full 40-character commit.',
	conflict: 'This request key already belongs to different details. Start a new request explicitly.',
	'not-found': 'This saved request is unavailable or has expired.',
	busy: 'Verification is busy. Wait before retrying.'
};

export function DeveloperSavedSubmissions({ session, initialId = null, onSessionExpired }: {
	readonly session: Session;
	readonly initialId?: string | null;
	readonly onSessionExpired: () => void;
}): React.JSX.Element {
	const [capability, setCapability] = useState<SubmissionCapability | { readonly kind: 'checking' }>({ kind: 'checking' });
	const [capabilityAttempt, setCapabilityAttempt] = useState(0);
	const [contractId, setContractId] = useState('');
	const [repository, setRepository] = useState('');
	const [commit, setCommit] = useState('');
	const [attempt, setAttempt] = useState<Attempt | null>(null);
	const [restoreId, setRestoreId] = useState(initialId);
	const [saved, setSaved] = useState<SavedSubmission | null>(null);
	const [error, setError] = useState<SubmissionError | null>(null);
	const [busy, setBusy] = useState(false);
	const [retryAt, setRetryAt] = useState(0);
	const active = useRef<AbortController | null>(null);
	const alive = useRef(true);
	const expired = useRef(onSessionExpired);
	expired.current = onSessionExpired;
	useEffect(() => {
		alive.current = true;
		return () => { alive.current = false; active.current?.abort(); };
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		void loadSubmissionCapability(controller.signal).then(value => {
			if (!controller.signal.aborted) setCapability(value);
		});
		return () => controller.abort();
	}, [capabilityAttempt]);
	useEffect(() => {
		if (!retryAt) return;
		let timer: number;
		const wait = () => {
			const remaining = retryAt - Date.now();
			if (remaining <= 0) setRetryAt(0);
			else timer = window.setTimeout(wait, Math.min(remaining, 2_147_483_647));
		};
		wait();
		return () => window.clearTimeout(timer);
	}, [retryAt]);

	function accept(response: SubmissionResponse): void {
		if (response.kind === 'saved') {
			setSaved(response.submission); setError(null); setRetryAt(0);
			setContractId(response.submission.request.contractId);
			setRepository(response.submission.request.repository);
			setCommit(response.submission.request.commit);
		}
		else {
			setError(response);
			if (response.kind === 'busy') setRetryAt(response.retryAt ?? Date.now() + 60_000);
			if (response.kind === 'signed-out') expired.current();
		}
	}
	useEffect(() => {
		if (!restoreId || session.kind !== 'signed-in' || capability.kind !== 'available') return;
		const controller = new AbortController();
		active.current = controller;
		setBusy(true);
		void readDeveloperSubmission(restoreId, controller.signal).then(response => {
			if (alive.current && !controller.signal.aborted) accept(response);
		}).finally(() => {
			if (active.current === controller) active.current = null;
			if (alive.current && !controller.signal.aborted) setBusy(false);
		});
		return () => controller.abort();
	}, [restoreId, session.kind, capability.kind]);

	async function run(mode: 'save' | 'read', request: Attempt | null = attempt): Promise<void> {
		if (active.current || session.kind !== 'signed-in' || capability.kind !== 'available' || retryAt > Date.now()) return;
		const readId = saved?.id ?? restoreId;
		if ((mode === 'save' && !request) || (mode === 'read' && !readId)) return;
		const controller = new AbortController();
		active.current = controller;
		setBusy(true);
		setError(null);
		try {
			const response = mode === 'read' ? await readDeveloperSubmission(readId!, controller.signal)
				: await saveDeveloperSubmission(request!.input, request!.key, controller.signal);
			if (!controller.signal.aborted && alive.current) accept(response);
		} finally {
			if (active.current === controller) active.current = null;
			if (alive.current && !controller.signal.aborted) setBusy(false);
		}
	}

	useEffect(() => {
		if (session.kind !== 'signed-in' || saved?.status !== 'checking' || error || active.current) return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			active.current = controller;
			void readDeveloperSubmission(saved.id, controller.signal).then(response => {
				if (alive.current && !controller.signal.aborted) accept(response);
			}).finally(() => { if (active.current === controller) active.current = null; });
		}, 5000);
		return () => { window.clearTimeout(timer); controller.abort(); };
	}, [saved, error, session.kind, busy]);

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		if (attempt || saved || restoreId || active.current) return;
		const input = submissionInput({ contractId: contractId.trim(), repository: repository.trim(), commit: commit.trim().toLowerCase() });
		if (!input) { setError({ kind: 'invalid' }); return; }
		try {
			const next = { input, key: crypto.randomUUID() };
			setAttempt(next);
			void run('save', next);
		} catch { setError({ kind: 'unavailable' }); }
	}
	function startAnother(): void {
		if (active.current || retryAt > Date.now()) return;
		setAttempt(null); setSaved(null); setRestoreId(null); setError(null);
	}
	const locked = busy || attempt !== null || saved !== null || restoreId !== null;
	return <section className={styles.section} aria-labelledby="developer-saved-requests">
		<h3 id="developer-saved-requests">Saved verification requests</h3>
		{capability.kind === 'checking' ? <p role="status">Checking saved-request availability…</p>
			: capability.kind === 'disabled' ? <p role="status">Saved verification requests are not enabled. Public build checks remain available.</p>
				: capability.kind === 'unavailable' ? <><p role="status">Saved-request availability could not be checked.</p>
					<button type="button" onClick={() => { setCapability({ kind: 'checking' }); setCapabilityAttempt(value => value + 1); }}>Retry availability check</button></>
					: session.kind === 'checking' ? <p role="status">Waiting for the GitHub session check…</p>
						: session.kind === 'disabled' || session.kind === 'unavailable' ? <p>GitHub sign-in must be available to save a request. Public checks remain available.</p>
							: session.kind !== 'signed-in' ? <p>Sign in with GitHub to save a private build-attestation check. Public checks do not require sign-in.</p>
						: <>
							<p>Check a published build attestation for an exact repository and commit. Results are private and retained for {capability.retentionDays} days after the check finishes.</p>
							<form className={styles.form} onSubmit={submit} aria-label="Save verification request">
								<label>Contract address<input required maxLength={56} autoComplete="off" spellCheck={false} disabled={locked}
									value={contractId} onChange={event => setContractId(event.target.value)} /></label>
								<label>GitHub repository (owner/repo)<input required maxLength={140} autoComplete="off" spellCheck={false} disabled={locked}
									value={repository} onChange={event => setRepository(event.target.value)} /></label>
								<label>Source commit (40 hex characters)<input required maxLength={40} autoComplete="off" spellCheck={false} disabled={locked}
									value={commit} onChange={event => setCommit(event.target.value)} /></label>
								{!attempt && !saved && !restoreId && <div className={styles.actions}><button type="submit" disabled={busy}>Save and check build</button></div>}
							</form>
							{busy && <p role="status">{saved || restoreId ? 'Loading saved result…' : 'Saving and checking published evidence…'}</p>}
							{error && <p role="alert">{saved && error.kind === 'unavailable' ? 'The saved result could not be refreshed. Try again.' : messages[error.kind]}{error.kind === 'wrong-origin' &&
								<> <a href="https://stellaratlas.io/developer/verification">Open main site</a></>}</p>}
							{retryAt > 0 && <p role="status">Retry after {new Date(retryAt).toLocaleTimeString()}.</p>}
							{saved && <DeveloperSubmissionResult value={saved} />}
							<div className={styles.actions}>
								{attempt && error && !saved && !restoreId && <button type="button" disabled={busy || retryAt > Date.now()}
									onClick={() => void run('save')}>Retry same request</button>}
								{(saved || restoreId) && error && <button type="button" disabled={busy || retryAt > Date.now()}
									onClick={() => void run('read')}>Refresh saved result</button>}
								{(attempt || saved || restoreId) && !busy && saved?.status !== 'checking' && <button type="button" disabled={retryAt > Date.now()}
									onClick={startAnother}>Start a new request</button>}
							</div>
						</>}
	</section>;
}
