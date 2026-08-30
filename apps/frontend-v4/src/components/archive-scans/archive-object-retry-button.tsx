'use client';

import { useState } from 'react';

interface ArchiveObjectRetryButtonProps {
	readonly evidenceUpdatedAt: string;
	readonly remoteId: string;
}

interface RecheckResponse {
	readonly reason?: string;
	readonly state?: string;
}

export function ArchiveObjectRetryButton({
	evidenceUpdatedAt,
	remoteId
}: ArchiveObjectRetryButtonProps): React.JSX.Element {
	const [isOpen, setIsOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [password, setPassword] = useState('');
	const [username, setUsername] = useState('');

	const submit = async (
		event: React.FormEvent<HTMLFormElement>
	): Promise<void> => {
		event.preventDefault();
		if (username.length === 0 || password.length === 0) {
			setMessage('Operator username and password are required.');
			return;
		}
		setIsSubmitting(true);
		setMessage(null);
		try {
			const response = await fetch(
				'/v1/archive-scans/objects/' +
					encodeURIComponent(remoteId) +
					'/recheck',
				{
					body: JSON.stringify({ minimumEvidenceUpdatedAt: evidenceUpdatedAt }),
					cache: 'no-store',
					credentials: 'omit',
					headers: {
						Accept: 'application/json',
						Authorization: 'Basic ' + window.btoa(username + ':' + password),
						'Content-Type': 'application/json'
					},
					method: 'POST'
				}
			);
			const result = (await response
				.json()
				.catch(() => null)) as RecheckResponse | null;
			if (response.status === 401) {
				setMessage('Operator credentials were rejected.');
				return;
			}
			if (!response.ok) {
				setMessage('Retry request failed with HTTP ' + response.status + '.');
				return;
			}
			setMessage(formatRecheckResult(result));
			if (result?.state === 'queued' || result?.state === 'already-queued') {
				setIsOpen(false);
			}
		} catch {
			setMessage('Retry request could not reach the API.');
		} finally {
			setPassword('');
			setIsSubmitting(false);
		}
	};

	return (
		<div className="archive-object-retry">
			<button
				aria-expanded={isOpen}
				disabled={isSubmitting}
				onClick={() => {
					setIsOpen((value) => !value);
					setMessage(null);
				}}
				type="button"
			>
				Retry once
			</button>
			{isOpen ? (
				<form onSubmit={(event) => void submit(event)}>
					<label>
						<span>Operator username</span>
						<input
							autoComplete="username"
							onChange={(event) => setUsername(event.target.value)}
							required
							value={username}
						/>
					</label>
					<label>
						<span>Operator password</span>
						<input
							autoComplete="current-password"
							onChange={(event) => setPassword(event.target.value)}
							required
							type="password"
							value={password}
						/>
					</label>
					<button disabled={isSubmitting} type="submit">
						{isSubmitting ? 'Submitting' : 'Confirm one retry'}
					</button>
				</form>
			) : null}
			{message === null ? null : <small role="status">{message}</small>}
		</div>
	);
}

function formatRecheckResult(result: RecheckResponse | null): string {
	if (result?.state === 'queued') return 'One retry was queued.';
	if (result?.state === 'already-queued')
		return 'This exact check is already queued.';
	if (result?.state === 'not-yet-eligible') {
		return (
			'This check is not eligible yet: ' + (result.reason ?? 'retry window')
		);
	}
	if (result?.state === 'blocked') {
		return 'Retry was not queued: ' + (result.reason ?? 'blocked');
	}
	return 'Retry request was accepted.';
}
