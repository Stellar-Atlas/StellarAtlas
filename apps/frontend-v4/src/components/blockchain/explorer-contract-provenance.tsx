'use client';

import { useEffect, useState, type FormEvent } from 'react';
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
const builderNextStep: Record<string, string> = {
	not_published: 'Publish a GitHub artifact attestation for the exact Wasm you deployed. A previous lookup may be cached for up to 30 minutes.',
	metadata_missing: 'Build and deploy Wasm with source_repo=github:OWNER/REPO in its metadata.',
	metadata_invalid: 'Correct the source metadata in your build and deploy the resulting Wasm.',
	unsupported: 'Use source_repo=github:OWNER/REPO to identify a publicly readable GitHub repository.',
	invalid: 'Check the signature, repository, workflow identity and Wasm hash in the published attestation.',
	unavailable: 'Atlas could not check the build evidence. Try again later.',
	builtin: 'Built-in asset contracts have no deployed Wasm build to attest.',
	not_found_at_ledger: 'Check the contract address and the observed ledger before trying again.'
};

type ExpectedBuild = {
	readonly contractId: string;
	readonly commit: string;
	readonly wasmSha256: string;
};

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function parseLedgerEvidence(value: unknown): 'configured_rpc_observation' | 'unspecified' | 'unknown' {
	if (value === 'configured_rpc_observation') return value;
	return value === undefined ? 'unspecified' : 'unknown';
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
	const [result, setValue] = useState<{
		contractId: string;
		attempt: number;
		value: EntityRecord | null;
	} | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [expectedBuild, setExpectedBuild] = useState<ExpectedBuild | null>(null);
	const [invalidInput, setInvalidInput] = useState<string | null>(null);
	const inputRejected = invalidInput === contractId;
	const activeResult =
		result?.contractId === contractId && result.attempt === attempt ? result : null;
	const value = inputRejected ? null : (activeResult?.value ?? null);
	const error = !inputRejected && activeResult !== null && value === null;
	useEffect(() => {
		if (attempt === 0) return;
		const controller = new AbortController();
		void requestExplorerJson(
			'/v1/contracts/' + encodeURIComponent(contractId) + '/provenance',
			controller.signal
		)
			.then((response) => {
				const evidence = recordValue(response);
				if (!controller.signal.aborted)
					setValue({
						contractId,
						attempt,
						value: evidence?.contractId === contractId ? evidence : null
					});
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setValue({ contractId, attempt, value: null });
			});
		return () => controller.abort();
	}, [contractId, attempt]);
	const build = recordValue(value?.build);
	const source = recordValue(build?.record);
	const metadata = recordValue(value?.metadata);
	const status = text(build?.status);
	const expected =
		!inputRejected && expectedBuild?.contractId === contractId ? expectedBuild : null;
	const pending = !inputRejected && attempt > 0 && activeResult === null;
	let builderResult = '';
	let builderDetail = '';
	if (expected && value) {
		if (text(value.wasmSha256) && value.wasmSha256 !== expected.wasmSha256) {
			builderResult = 'Wasm hash mismatch';
			builderDetail = 'The deployed Wasm hash differs from the hash you entered. Check the release artifact and contract address.';
		} else if (status === 'verified' && value.wasmSha256 === expected.wasmSha256) {
			if (source?.commit === expected.commit) {
				builderResult = 'Your build is attested';
			} else {
				builderResult = 'Source commit mismatch';
				builderDetail = 'The signed attestation identifies a different source commit from the one you entered.';
			}
		} else {
			builderResult = status === 'verified' ? 'Build unconfirmed' : (labels[status] ?? 'Build unconfirmed');
			builderDetail = builderNextStep[status] ?? 'Atlas could not confirm the requested build from the available evidence.';
		}
	}
	const ledgerEvidence = parseLedgerEvidence(value?.ledgerEvidence);
	const commitUrl = githubLink(source?.sourceUrl);
	const workflowUrl = githubLink(source?.workflowUrl);
	const runUrl = githubLink(source?.runUrl);
	const repository = text(metadata?.sourceRepository);
	function verifyBuild(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const commit = form.querySelector<HTMLInputElement>('input[data-build-field="commit"]')
			?.value.trim().toLowerCase() ?? '';
		const wasmSha256 = form.querySelector<HTMLInputElement>('input[data-build-field="wasmSha256"]')
			?.value.trim().toLowerCase() ?? '';
		if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{64}$/.test(wasmSha256)) {
			setInvalidInput(contractId);
			return;
		}
		setInvalidInput(null);
		setExpectedBuild({ contractId, commit, wasmSha256 });
		setAttempt((current) => current + 1);
	}

	return (
		<section className={styles.panel} aria-label="Contract build provenance">
			<div className={styles.heading}>
				<h2>Build provenance</h2>
				{inputRejected ? null : attempt === 0 ? (
					<button onClick={() => setAttempt(1)}>Check build</button>
				) : (
					<span
						role="status"
						className={
							status === 'verified' && (!expected || builderResult === 'Your build is attested')
								? styles.verified
								: styles.status
						}
					>
						{error
							? 'Temporarily unavailable'
							: value
								? (builderResult || labels[status] || 'Not assessed')
								: 'Checking'}
					</span>
				)}
			</div>
			<details className={styles.builder} key={contractId}>
				<summary>Verify my build</summary>
				<p>
					Atlas checks the code on Stellar and compares signed build evidence
					to the release details you enter below.
				</p>
				<ol>
					<li>Build with <code>source_repo=github:OWNER/REPO</code> in the Wasm metadata.</li>
					<li>Publish GitHub build provenance for the final Wasm and deploy those exact bytes.</li>
					<li>Enter the workflow run’s source commit and artifact SHA-256 below.</li>
				</ol>
				<p>
					<a href="/docs/contract-verification#publish-build">Open the publishing steps and worked example</a>
				</p>
				<form onSubmit={verifyBuild}>
					<label>
						Source commit (40 hex characters)
						<input data-build-field="commit" required spellCheck={false} autoComplete="off" />
					</label>
					<label>
						Wasm SHA-256 (64 hex characters)
						<input data-build-field="wasmSha256" required spellCheck={false} autoComplete="off" />
					</label>
					<button type="submit" disabled={pending}>Verify build</button>
				</form>
				{inputRejected && (
					<p role="alert">Enter the full 40-character commit and 64-character Wasm hash in hexadecimal.</p>
				)}
				{expected && (
					<>
						<p className={styles.expected}>
							Requested commit <code>{expected.commit}</code> and Wasm hash{' '}
							<code>{expected.wasmSha256}</code>.
						</p>
						{builderDetail && <p>{builderDetail}</p>}
						{value && (
							<p>
								<button onClick={() => setAttempt((current) => current + 1)}>
									Check again
								</button>
							</p>
						)}
					</>
				)}
			</details>
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
						{ledgerEvidence !== 'unspecified' && (
							<>
								<dt>Ledger evidence</dt>
								<dd className={styles.muted}>
									{ledgerEvidence === 'configured_rpc_observation'
										? 'Configured RPC observation. Not an independent ledger-state proof.'
										: 'Unrecognized ledger evidence. Do not treat it as a ledger-state proof.'}
								</dd>
							</>
						)}
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
							The signed build matches the deployed Wasm hash. Source
							reproduction and security audit are separate checks.
						</p>
					)}
				</>
			) : pending ? (
				<p className={styles.muted}>
					Checking deployed code and available build records…
				</p>
			) : null}
		</section>
	);
}
