'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
	readReviewApplication,
	readReviewQueue,
	readVerificationCapabilities,
	requestVerification,
	verificationId,
	VerificationRequestError,
	type ReviewApplication,
	type VerificationNetwork
} from '../../api/atlas-verification';
import {
	VerificationAuthentication,
	type VerificationSession
} from './verification-authentication';
import { LocalDateTime } from '../local-date-time';
import styles from './verification-application.module.css';

export function VerificationReview(): React.JSX.Element {
	const [networks, setNetworks] = useState<
		readonly VerificationNetwork[] | null
	>(null);
	const [status, setStatus] = useState('Checking review availability…');
	const [session, setSession] = useState<VerificationSession | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		void requestVerification('/capabilities', controller.signal)
			.then(readVerificationCapabilities)
			.then((value) => {
				if (controller.signal.aborted) return;
				setNetworks(value.available ? value.networks : null);
				setStatus(
					value.available
						? 'Sign in with an authorized reviewer account.'
						: 'Atlas verification is not enabled.'
				);
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setStatus('Review availability could not be checked.');
			});
		return () => controller.abort();
	}, []);
	return (
		<section className={styles.panel} aria-label="Atlas identity review">
			<p role="status">{status}</p>
			{networks && (
				<VerificationAuthentication
					networks={networks}
					onSession={setSession}
				/>
			)}
			{session && (
				<VerificationReviewPanel
					key={session.token}
					session={session}
					onExpired={() => setSession(null)}
				/>
			)}
		</section>
	);
}

type DecisionState = 'approved' | 'changes_requested' | 'rejected' | 'revoked';
export function VerificationReviewPanel({
	session,
	onExpired
}: {
	readonly session: VerificationSession;
	readonly onExpired: () => void;
}): React.JSX.Element {
	const [page, setPage] = useState<ReturnType<typeof readReviewQueue> | null>(
		null
	);
	const [authorized, setAuthorized] = useState(false);
	const [selected, setSelected] = useState<ReviewApplication | null>(null);
	const [lookup, setLookup] = useState('');
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const [decision, setDecision] = useState<DecisionState>('changes_requested');
	const [reason, setReason] = useState('');
	const [reviewed, setReviewed] = useState(false);
	const [confirmed, setConfirmed] = useState(false);
	const lifetime = useRef<AbortController | null>(null),
		inFlight = useRef(false);
	const expired = useRef(onExpired);
	expired.current = onExpired;
	useEffect(() => {
		const controller = new AbortController();
		lifetime.current = controller;
		const timer = setTimeout(
			() => {
				controller.abort();
				expired.current();
			},
			Math.max(0, Date.parse(session.expiresAt) - Date.now())
		);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [session.token, session.expiresAt]);
	function choose(value: ReviewApplication | null) {
		setSelected(value);
		setLookup(value?.id ?? lookup);
		setReason('');
		setReviewed(false);
		setConfirmed(false);
		setDecision(value?.state === 'approved' ? 'revoked' : 'changes_requested');
	}
	async function run(action: (signal: AbortSignal) => Promise<void>) {
		if (
			inFlight.current ||
			!lifetime.current ||
			lifetime.current.signal.aborted
		)
			return;
		if (Date.parse(session.expiresAt) <= Date.now()) {
			expired.current();
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setMessage('');
		try {
			await action(lifetime.current.signal);
		} catch (error) {
			if (lifetime.current.signal.aborted) return;
			if (
				error instanceof VerificationRequestError &&
				[401, 403].includes(error.status)
			) {
				setAuthorized(false);
				setPage(null);
				choose(null);
				if (error.status === 401) expired.current();
			}
			if (error instanceof VerificationRequestError && error.status === 409)
				choose(null);
			setMessage(
				error instanceof VerificationRequestError
					? error.message
					: 'Review request unavailable.'
			);
		} finally {
			inFlight.current = false;
			if (!lifetime.current.signal.aborted) setBusy(false);
		}
	}
	const load = (after = '') =>
		run(async (signal) => {
			const result = readReviewQueue(
				await requestVerification(
					'/review' + (after ? '?after=' + after : ''),
					signal,
					session
				)
			);
			if (signal.aborted) return;
			setPage(result);
			setAuthorized(true);
			choose(null);
		});
	const lookupApplication = () =>
		run(async (signal) => {
			if (!authorized || !verificationId(lookup)) {
				setMessage('Enter a valid application ID.');
				return;
			}
			const value = readReviewApplication(
				await requestVerification('/applications/' + lookup, signal, session)
			);
			if (value.id !== lookup) throw new VerificationRequestError(503);
			if (!signal.aborted) choose(value);
		});
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (
			!authorized ||
			!selected ||
			!confirmed ||
			!reason.trim() ||
			(decision === 'approved' && !reviewed)
		)
			return;
		const application = selected;
		void run(async (signal) => {
			const value = readReviewApplication(
				await requestVerification(
					'/applications/' + application.id + '/decisions',
					signal,
					session,
					{
						revision: application.revision,
						state: decision,
						reason: reason.trim(),
						identityEvidenceReviewed: reviewed
					}
				)
			);
			if (signal.aborted) return;
			if (
				value.id !== application.id ||
				value.network !== application.network ||
				value.address !== application.address ||
				value.revision !== application.revision + 1 ||
				value.state !== decision
			)
				throw new VerificationRequestError(503);
			setPage((previous) =>
				previous
					? {
							...previous,
							items: previous.items.filter((item) => item.id !== value.id)
						}
					: null
			);
			choose(value);
			setMessage('Decision saved: ' + value.state.replaceAll('_', ' ') + '.');
		});
	}
	return (
		<div aria-label="Private reviewer workspace" aria-busy={busy}>
			<h2>Review applications</h2>
			<p>
				Private evidence · Access is checked by the server for every request.
			</p>
			<button type="button" disabled={busy} onClick={() => void load()}>
				Load pending queue
			</button>
			{authorized && (
				<>
					<p>{page?.items.length ?? 0} applications on this page</p>
					<ul className={styles.reviewQueue}>
						{page?.items.map((item) => (
							<li key={item.id}>
								<div>
									<strong>
										<bdi>{item.name}</bdi>
									</strong>{' '}
									· {item.network}
									<br />
									<code>{item.address}</code>
								</div>
								<button
									type="button"
									disabled={busy}
									onClick={() => choose(item)}
								>
									Review
								</button>
							</li>
						))}
					</ul>
					{page?.nextCursor && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void load(page.nextCursor!)}
						>
							Next 20 applications
						</button>
					)}
					<form
						className={styles.lookup}
						onSubmit={(event) => {
							event.preventDefault();
							void lookupApplication();
						}}
					>
						<label>
							Application ID
							<input
								value={lookup}
								onChange={(event) => setLookup(event.target.value)}
								maxLength={36}
								required
								autoComplete="off"
							/>
						</label>
						<button disabled={busy} type="submit">
							Load application
						</button>
					</form>
				</>
			)}
			{authorized && selected && (
				<section
					className={styles.status}
					aria-label="Selected private application"
				>
					<h3>
						<bdi>{selected.name}</bdi>
					</h3>
					<dl className="explorer-result-grid">
						<div>
							<dt>Account ({selected.network})</dt>
							<dd>
								{selected.network === 'mainnet' ? (
									<a href={'/explorer/accounts/' + selected.address}>
										{selected.address}
									</a>
								) : (
									<code>{selected.address}</code>
								)}
							</dd>
						</div>
						<div>
							<dt>Website claimed by applicant</dt>
							<dd>
								<a
									href={selected.website}
									target="_blank"
									rel="noopener noreferrer"
								>
									{selected.website}
								</a>
							</dd>
						</div>
						<div>
							<dt>Status / revision</dt>
							<dd>
								{selected.state.replaceAll('_', ' ')} / {selected.revision}
							</dd>
						</div>
						<div>
							<dt>Submitted</dt>
							<dd>
								<LocalDateTime dateTime={selected.submittedAt} />
							</dd>
						</div>
						<div>
							<dt>Previous account-control check</dt>
							<dd>
								<LocalDateTime dateTime={selected.controlVerifiedAt} />
							</dd>
						</div>
					</dl>
					<h4>Private supporting evidence</h4>
					<p className={styles.evidence}>{selected.supportingEvidence}</p>
					{selected.reason && <p>Previous review: {selected.reason}</p>}
					{(selected.state === 'pending' || selected.state === 'approved') && (
						<form className={styles.form} onSubmit={submit}>
							<fieldset disabled={busy}>
								<legend>Record decision</legend>
								<label>
									Decision
									<select
										value={decision}
										onChange={(event) => {
											setDecision(event.target.value as DecisionState);
											setConfirmed(false);
										}}
									>
										{selected.state === 'approved' ? (
											<option value="revoked">Revoke verification</option>
										) : (
											<>
												<option value="changes_requested">
													Request changes
												</option>
												<option value="rejected">Reject application</option>
												<option value="approved">Approve identity</option>
											</>
										)}
									</select>
								</label>
								<label>
									Reason
									<textarea
										value={reason}
										onChange={(event) => setReason(event.target.value)}
										maxLength={1000}
										rows={3}
										required
									/>
								</label>
								{decision === 'approved' && (
									<>
										<p>
											Approval publishes this name and website. The server
											rechecks current account authority.
										</p>
										<label className={styles.check}>
											<input
												type="checkbox"
												checked={reviewed}
												onChange={(event) => setReviewed(event.target.checked)}
												required
											/>
											I reviewed identity evidence separately from account
											control.
										</label>
									</>
								)}
								<label className={styles.check}>
									<input
										type="checkbox"
										checked={confirmed}
										onChange={(event) => setConfirmed(event.target.checked)}
										required
									/>
									Confirm this decision.
								</label>
								<button
									type="submit"
									disabled={
										!confirmed ||
										!reason.trim() ||
										(decision === 'approved' && !reviewed)
									}
								>
									Save decision
								</button>
							</fieldset>
						</form>
					)}
				</section>
			)}
			{message && (
				<p role="status" aria-live="polite">
					{message}
				</p>
			)}
		</div>
	);
}
