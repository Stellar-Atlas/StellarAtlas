'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import styles from './verification-application.module.css';
import {
	readApplication,
	type VerificationDraft as Draft,
	type SavedApplication as Saved
} from '../../api/verification-application';
export { readApplication } from '../../api/verification-application';
import {
	VerificationAuthentication,
	type VerificationSession
} from './verification-authentication';

const endpoint = '/v1/account-verification';
const empty: Draft = {
	network: 'mainnet',
	address: '',
	name: '',
	website: '',
	supportingEvidence: ''
};
export function VerificationApplication(): React.JSX.Element {
	const [available, setAvailable] = useState<boolean | null>(null);
	const [authNetworks, setAuthNetworks] = useState<('mainnet' | 'testnet')[]>(
		[]
	);
	const [session, setSession] = useState<VerificationSession | null>(null);
	const [draft, setDraft] = useState<Draft>(empty);
	const [saved, setSaved] = useState<Saved | null>(null);
	const [lookupId, setLookupId] = useState('');
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const lifetime = useRef<AbortController | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		lifetime.current = controller;
		void fetch(endpoint + '/capabilities', {
			cache: 'no-store',
			credentials: 'same-origin',
			signal: controller.signal
		})
			.then(async (response) => {
				if (!response.ok) throw new Error();
				const data: unknown = await response.json();
				if (!controller.signal.aborted) {
					if (
						data &&
						typeof data === 'object' &&
						'authentication' in data &&
						data.authentication === 'stellar-challenge' &&
						'networks' in data &&
						Array.isArray(data.networks)
					)
						setAuthNetworks(
							data.networks.filter(
								(value): value is 'mainnet' | 'testnet' =>
									value === 'mainnet' || value === 'testnet'
							)
						);
					setAvailable(
						!!data &&
							typeof data === 'object' &&
							'available' in data &&
							data.available === true
					);
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) setAvailable(false);
			});
		return () => controller.abort();
	}, []);
	async function request(path: string, init?: RequestInit): Promise<void> {
		if (busy || !available) return;
		if (
			authNetworks.length &&
			(!session || Date.parse(session.expiresAt) <= Date.now())
		) {
			setMessage('Authenticate your account before continuing.');
			return;
		}
		setBusy(true);
		setMessage('');
		try {
			const response = await fetch(endpoint + path, {
				...init,
				headers: {
					...init?.headers,
					...(session ? { Authorization: 'Bearer ' + session.token } : {})
				},
				credentials: session ? 'omit' : 'same-origin',
				cache: 'no-store',
				signal: lifetime.current?.signal
			});
			if (response.status === 401)
				throw new Error(
					'Sign in to Atlas and complete the account-control check before submitting.'
				);
			if (response.status === 403)
				throw new Error(
					'A current account-control check is required for this application.'
				);
			if (response.status === 409)
				throw new Error(
					'The application changed or already exists. Load its latest status before continuing.'
				);
			if (response.status === 404)
				throw new Error('Application not found for your signed-in account.');
			if (!response.ok)
				throw new Error(
					'The request could not be completed. Review your fields and try again.'
				);
			const application = readApplication(await response.json());
			if (!application)
				throw new Error('The application response could not be read.');
			if (lifetime.current?.signal.aborted) return;
			setSaved(application);
			setDraft({
				network: application.network,
				address: application.address,
				name: application.name,
				website: application.website,
				supportingEvidence: application.supportingEvidence
			});
			setLookupId(application.id);
			setMessage('Application saved. You can check its status here.');
		} catch (error) {
			if (!lifetime.current?.signal.aborted)
				setMessage(
					error instanceof Error ? error.message : 'Request unavailable.'
				);
		} finally {
			if (!lifetime.current?.signal.aborted) setBusy(false);
		}
	}
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		void request(
			saved ? '/applications/' + saved.id + '/resubmit' : '/applications',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					saved ? { ...draft, revision: saved.revision } : draft
				)
			}
		);
	}
	const canEdit =
		!saved ||
		['changes_requested', 'rejected', 'revoked'].includes(saved.state);
	return (
		<section
			className={styles.panel}
			aria-labelledby="atlas-verification-title"
		>
			<h2 id="atlas-verification-title">Get verified by Atlas</h2>
			<p>
				Apply directly to Atlas for a public account identity. A Stellar Expert
				listing is optional.
			</p>
			<p>
				Atlas checks account control and reviews the claimed identity before
				publishing a verification badge.
			</p>
			{available === null && (
				<p role="status">Checking application availability…</p>
			)}
			{available === false && (
				<p role="status">
					Atlas verification applications are not open yet. Please check back
					here.
				</p>
			)}
			{available === true && (
				<>
					{authNetworks.length > 0 && (
						<VerificationAuthentication
							networks={authNetworks}
							onSession={(value) => {
								setSession(value);
								setSaved(null);
								setLookupId('');
								setMessage('');
								setDraft(
									value
										? {
												...empty,
												network: value.network,
												address: value.address
											}
										: empty
								);
							}}
						/>
					)}
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (uuid(lookupId)) void request('/applications/' + lookupId);
							else setMessage('Enter a valid application ID.');
						}}
						className={styles.lookup}
					>
						<label>
							Application ID
							<input
								value={lookupId}
								onChange={(event) => setLookupId(event.target.value)}
								maxLength={36}
								required
								autoComplete="off"
							/>
						</label>
						<button type="submit" disabled={busy}>
							Load application
						</button>
					</form>
					{saved && (
						<div className={styles.status}>
							<p>
								<strong>
									Application status: {saved.state.replaceAll('_', ' ')}
								</strong>
							</p>
							<p>
								Application ID: <code>{saved.id}</code>
							</p>
							{saved.state === 'pending' && (
								<p>
									Your request is awaiting Atlas review. It has no public
									verification badge yet.
								</p>
							)}
							{saved.reason && <p>Atlas review: {saved.reason}</p>}
						</div>
					)}
					<form onSubmit={submit} className={styles.form}>
						<fieldset disabled={busy || !canEdit}>
							<legend>
								{saved ? 'Application details' : 'Your account identity'}
							</legend>
							<div className={styles.fields}>
								<label>
									Network
									<select
										value={draft.network}
										disabled={!!saved}
										onChange={(event) =>
											setDraft({
												...draft,
												network: event.target.value as Draft['network']
											})
										}
									>
										<option value="mainnet">Mainnet</option>
										<option value="testnet">Testnet</option>
									</select>
								</label>
								<label>
									Account address
									<input
										value={draft.address}
										disabled={!!saved}
										onChange={(event) =>
											setDraft({ ...draft, address: event.target.value })
										}
										pattern="G[A-Z2-7]{55}"
										maxLength={56}
										required
										spellCheck={false}
										autoComplete="off"
									/>
								</label>
								<label>
									Public name
									<input
										value={draft.name}
										onChange={(event) =>
											setDraft({ ...draft, name: event.target.value })
										}
										maxLength={120}
										required
									/>
								</label>
								<label>
									Official website
									<input
										type="url"
										value={draft.website}
										onChange={(event) =>
											setDraft({ ...draft, website: event.target.value })
										}
										placeholder="https://"
										maxLength={512}
										required
									/>
								</label>
							</div>
							<label>
								Supporting evidence
								<textarea
									value={draft.supportingEvidence}
									onChange={(event) =>
										setDraft({
											...draft,
											supportingEvidence: event.target.value
										})
									}
									rows={6}
									maxLength={4000}
									required
									aria-describedby="evidence-help"
								/>
							</label>
							<p id="evidence-help">
								Explain how this account connects to the public identity and
								website. Supporting evidence is private to you and authorized
								Atlas reviewers. Never include a secret key or recovery phrase.
							</p>
							{canEdit && (
								<button type="submit">
									{busy
										? 'Saving…'
										: saved
											? 'Resubmit for review'
											: 'Submit for review'}
								</button>
							)}
						</fieldset>
					</form>
					{saved && (
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setSaved(null);
								setDraft(empty);
								setLookupId('');
								setMessage('');
							}}
						>
							Start another application
						</button>
					)}
				</>
			)}
			{message && (
				<p role="status" aria-live="polite">
					{message}
				</p>
			)}
		</section>
	);
}
function uuid(value: string): boolean {
	return /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}
