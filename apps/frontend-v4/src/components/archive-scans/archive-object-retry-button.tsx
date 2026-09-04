'use client';

import { useState } from 'react';
import { requestArchiveObjectRecheck } from '@app/actions/archive-object-recheck';

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
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const submit = async (): Promise<void> => {
		setIsSubmitting(true);
		setMessage(null);
		try {
			const response = await requestArchiveObjectRecheck({
				evidenceUpdatedAt,
				remoteId
			});
			if (response.status === 429) {
				setMessage('Too many retry requests. Wait one minute and try again.');
				return;
			}
			if (response.status < 200 || response.status >= 300) {
				setMessage('Retry request failed with HTTP ' + response.status + '.');
				return;
			}
			setMessage(formatRecheckResult(response.body));
		} catch {
			setMessage('Retry request could not reach the API.');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="archive-object-retry">
			<button
				disabled={isSubmitting}
				onClick={() => void submit()}
				type="button"
			>
				{isSubmitting ? 'Submitting' : 'Retry once'}
			</button>
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
