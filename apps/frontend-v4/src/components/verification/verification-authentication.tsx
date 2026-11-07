'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export interface VerificationSession {
	readonly token: string;
	readonly expiresAt: string;
	readonly network: 'mainnet' | 'testnet';
	readonly address: string;
}
interface Challenge {
	readonly transaction: string;
	readonly expiresAt: string;
	readonly network: 'mainnet' | 'testnet';
	readonly homeDomain: string;
	readonly serverAccount: string;
}
export function VerificationAuthentication({
	networks,
	onSession
}: {
	readonly networks: readonly ('mainnet' | 'testnet')[];
	readonly onSession: (session: VerificationSession | null) => void;
}): React.JSX.Element {
	const [network, setNetwork] = useState<'mainnet' | 'testnet'>(
		networks[0] ?? 'mainnet'
	);
	const [address, setAddress] = useState('');
	const [challenge, setChallenge] = useState<Challenge | null>(null);
	const [signed, setSigned] = useState('');
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState('');
	const [session, setSession] = useState<VerificationSession | null>(null);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => {
		controller.current = new AbortController();
		return () => controller.current?.abort();
	}, []);
	async function post(path: string, body: object): Promise<unknown> {
		const response = await fetch('/v1/account-verification/auth/' + path, {
			method: 'POST',
			credentials: 'omit',
			cache: 'no-store',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.current?.signal
		});
		if (response.status === 429)
			throw new Error(
				'Authentication is busy. Wait one minute before trying again.'
			);
		if (!response.ok)
			throw new Error(
				'Authentication failed. Check the account, network, expiry and required wallet signatures.'
			);
		return response.json() as Promise<unknown>;
	}
	async function start(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setMessage('');
		setSigned('');
		setChallenge(null);
		try {
			const value = await post('challenge', { network, address });
			const row = value as Partial<Challenge> | null;
			if (
				!row ||
				row.network !== network ||
				typeof row.transaction !== 'string' ||
				row.transaction.length > 16384 ||
				typeof row.expiresAt !== 'string' ||
				!Number.isFinite(Date.parse(row.expiresAt)) ||
				row.homeDomain !== window.location.hostname ||
				typeof row.serverAccount !== 'string' ||
				!/^G[A-Z2-7]{55}$/.test(row.serverAccount)
			)
				throw new Error('The authentication challenge could not be read.');
			if (!controller.current?.signal.aborted) setChallenge(row as Challenge);
		} catch (error) {
			if (!controller.current?.signal.aborted)
				setMessage(
					error instanceof Error ? error.message : 'Authentication unavailable.'
				);
		} finally {
			if (!controller.current?.signal.aborted) setBusy(false);
		}
	}
	async function finish(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !challenge) return;
		setBusy(true);
		setMessage('');
		try {
			const value = await post('session', {
				network: challenge.network,
				transaction: signed.trim()
			});
			const row = value as Partial<VerificationSession> | null;
			if (
				!row ||
				typeof row.token !== 'string' ||
				!/^[A-Za-z0-9_-]{43}$/.test(row.token) ||
				row.network !== network ||
				row.address !== address ||
				typeof row.expiresAt !== 'string' ||
				!Number.isFinite(Date.parse(row.expiresAt)) ||
				Date.parse(row.expiresAt) <= Date.now()
			)
				throw new Error('The authentication session could not be read.');
			if (!controller.current?.signal.aborted) {
				setSession(row as VerificationSession);
				onSession(row as VerificationSession);
				setSigned('');
				setChallenge(null);
			}
		} catch (error) {
			if (!controller.current?.signal.aborted)
				setMessage(
					error instanceof Error ? error.message : 'Authentication unavailable.'
				);
		} finally {
			if (!controller.current?.signal.aborted) setBusy(false);
		}
	}
	async function logout() {
		const previous = session;
		setSession(null);
		onSession(null);
		if (previous)
			try {
				await fetch('/v1/account-verification/auth/session', {
					method: 'DELETE',
					credentials: 'omit',
					cache: 'no-store',
					headers: { Authorization: 'Bearer ' + previous.token },
					signal: controller.current?.signal
				});
			} catch {
				/* Local token is already discarded. */
			}
	}
	return (
		<section aria-labelledby="verification-sign-in">
			<h3 id="verification-sign-in">Authenticate your account</h3>
			<p>
				Use an existing classic Stellar account. Atlas checks the wallet
				signatures against its current account signers and thresholds.
			</p>
			{session && Date.parse(session.expiresAt) > Date.now() ? (
				<>
					<p>
						Authenticated: <code>{session.address}</code> on {session.network}.
						Session expires at {session.expiresAt}.
					</p>
					<button
						type="button"
						onClick={() => {
							void logout();
						}}
					>
						Sign out
					</button>
				</>
			) : (
				<>
					<form onSubmit={start}>
						<fieldset disabled={busy || !!challenge}>
							<legend>Request a wallet challenge</legend>
							<label>
								Network
								<select
									value={network}
									onChange={(event) =>
										setNetwork(event.target.value as typeof network)
									}
								>
									{networks.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</select>
							</label>
							<label>
								Account address
								<input
									value={address}
									onChange={(event) => setAddress(event.target.value)}
									pattern="G[A-Z2-7]{55}"
									maxLength={56}
									required
									autoComplete="off"
									spellCheck={false}
								/>
							</label>
							<p>
								Requesting a challenge sends this account address and network to
								Atlas. Signing it authenticates account control; Atlas reviews
								the public identity separately.
							</p>
							<button type="submit">Request challenge</button>
						</fieldset>
					</form>
					{challenge && (
						<form onSubmit={finish}>
							<fieldset disabled={busy}>
								<legend>Sign with your wallet</legend>
								<p>
									Use your wallet’s authentication-challenge verification.
									Confirm {challenge.homeDomain}, {challenge.network}, sequence
									number 0, and the server signing account published by Atlas.
									Do not submit this authentication transaction to the Stellar
									network.
								</p>
								<p>
									Server signing account: <code>{challenge.serverAccount}</code>
									. Challenge expires at {challenge.expiresAt}.
								</p>
								<label>
									Authentication challenge XDR
									<textarea readOnly rows={5} value={challenge.transaction} />
								</label>
								<label>
									Wallet-signed challenge XDR
									<textarea
										rows={5}
										value={signed}
										onChange={(event) => setSigned(event.target.value)}
										maxLength={16384}
										required
										autoComplete="off"
										spellCheck={false}
									/>
								</label>
								<button type="submit">Authenticate signed challenge</button>
								<button
									type="button"
									onClick={() => {
										setChallenge(null);
										setSigned('');
									}}
								>
									Request a new challenge
								</button>
							</fieldset>
						</form>
					)}
				</>
			)}
			{message && <p role="status">{message}</p>}
		</section>
	);
}
