'use client';

import { useEffect, useState } from 'react';
import { ExplorerLink as Link } from './explorer-investigation';
import {
	recordValue,
	requestExplorerJson,
	type EntityRecord
} from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-contract-provenance.module.css';

const labels: Record<string, string> = {
	verified: 'Build attested',
	not_published: 'No published build',
	metadata_missing: 'No source metadata',
	metadata_invalid: 'Invalid source metadata',
	unsupported: 'Unsupported source metadata',
	invalid: 'Build verification failed',
	unavailable: 'Build check unavailable',
	builtin: 'Built-in asset contract',
	not_found_at_ledger: 'Not found at this ledger'
};
function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
function githubLink(value: unknown): string | null {
	return typeof value === 'string' &&
		/^https:\/\/github\.com\/[A-Za-z0-9_.\/-]+$/.test(value)
		? value
		: null;
}

export function ExplorerContractProvenance({
	contractId
}: {
	readonly contractId: string;
}): React.JSX.Element {
	const [value, setValue] = useState<EntityRecord | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (attempt === 0) return;
		const controller = new AbortController();
		setValue(null);
		setError(false);
		void requestExplorerJson(
			'/v1/contracts/' + encodeURIComponent(contractId) + '/provenance',
			controller.signal
		)
			.then((response) => {
				if (!controller.signal.aborted) setValue(recordValue(response));
			})
			.catch(() => {
				if (!controller.signal.aborted) setError(true);
			});
		return () => controller.abort();
	}, [contractId, attempt]);
	const build = recordValue(value?.build);
	const source = recordValue(build?.record);
	const metadata = recordValue(value?.metadata);
	const status = text(build?.status);
	const commitUrl = githubLink(source?.sourceUrl);
	const workflowUrl = githubLink(source?.workflowUrl);
	const runUrl = githubLink(source?.runUrl);
	const repository = text(metadata?.sourceRepository);
	return (
		<section className={styles.panel} aria-label="Contract build provenance">
			<div className={styles.heading}>
				<h2>Build provenance</h2>
				{attempt === 0 ? (
					<button onClick={() => setAttempt(1)}>Check build</button>
				) : (
					<span
						className={status === 'verified' ? styles.verified : styles.status}
					>
						{error
							? 'Temporarily unavailable'
							: value
								? (labels[status] ?? 'Not assessed')
								: 'Checking'}
					</span>
				)}
			</div>
			{error ? (
				<p>
					Contract evidence is unavailable.{' '}
					<button onClick={() => setAttempt((current) => current + 1)}>
						Retry
					</button>
				</p>
			) : value ? (
				<>
					<dl className={styles.details}>
						<dt>Observed ledger</dt>
						<dd>
							<Link href={'/explorer/ledgers/' + String(value.observedLedger)}>
								{Number(value.observedLedger).toLocaleString()}
							</Link>
							{text(value.checkedAt) && (
								<>
									{' '}
									· <LocalDateTime dateTime={text(value.checkedAt)} />
								</>
							)}
						</dd>
						{text(value.wasmSha256) && (
							<>
								<dt>Wasm SHA-256</dt>
								<dd>
									<code>{text(value.wasmSha256)}</code>
								</dd>
							</>
						)}
						{repository && (
							<>
								<dt>Embedded repository</dt>
								<dd>
									<a
										href={'https://github.com/' + repository}
										target="_blank"
										rel="noreferrer"
									>
										{repository}
									</a>
									{status !== 'verified' && (
										<span className={styles.muted}> · Developer supplied</span>
									)}
								</dd>
							</>
						)}
						{commitUrl && (
							<>
								<dt>Source commit</dt>
								<dd>
									<a href={commitUrl} target="_blank" rel="noreferrer">
										<code>{text(source?.commit)}</code>
									</a>
								</dd>
							</>
						)}
					</dl>
					{(workflowUrl || runUrl) && (
						<p className={styles.links}>
							{workflowUrl && (
								<a href={workflowUrl} target="_blank" rel="noreferrer">
									Build workflow ↗
								</a>
							)}
							{runUrl && (
								<a href={runUrl} target="_blank" rel="noreferrer">
									Build run ↗
								</a>
							)}
						</p>
					)}
					{status === 'verified' && (
						<p className={styles.muted}>
							The signed build matches this Wasm hash. This is not a security
							audit.
						</p>
					)}
				</>
			) : attempt > 0 ? (
				<p className={styles.muted}>
					Checking deployed code and available build records…
				</p>
			) : null}
		</section>
	);
}
