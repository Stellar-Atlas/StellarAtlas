import type { SavedSubmission, SubmissionStatus } from '../../api/developer-submissions';
import { LocalDateTime } from '../local-date-time';
import styles from './developer-submissions.module.css';

const outcomes: Record<SubmissionStatus, string> = {
	verified: 'Published build attestation matches',
	source_mismatch: 'Published source does not match your request',
	not_published: 'No published build attestation found',
	metadata_missing: 'Source metadata is missing',
	metadata_invalid: 'Source metadata is invalid',
	unsupported: 'Source metadata is unsupported',
	invalid: 'Build attestation could not be verified',
	unavailable: 'Build check unavailable',
	builtin: 'Built-in asset contract — no Wasm build to attest',
	not_found_at_ledger: 'Contract not found at the observed ledger'
};

export function DeveloperSubmissionResult({ value }: { readonly value: SavedSubmission }): React.JSX.Element {
	const evidence = value.result?.evidence;
	return <section className={styles.result} aria-label="Saved verification result">
		<h3 aria-live="polite">{value.status === 'checking' ? 'Saved · checking published build evidence'
			: value.result ? outcomes[value.result.status] : 'Build check unavailable'}</h3>
		<dl>
			<dt>Contract</dt><dd><a href={'/explorer/contracts/' + value.request.contractId}>{value.request.contractId}</a></dd>
			<dt>Requested source</dt><dd><a href={'https://github.com/' + value.request.repository + '/commit/' + value.request.commit}
				target="_blank" rel="noreferrer">{value.request.repository} · {value.request.commit}</a></dd>
			{evidence && <><dt>Observed ledger</dt><dd><a href={'/explorer/ledgers/' + evidence.observedLedger}>
				{evidence.observedLedger.toLocaleString('en-US')}</a> · <LocalDateTime dateTime={evidence.checkedAt} /></dd>
				{evidence.wasmSha256 && <><dt>Wasm SHA-256</dt><dd><code>{evidence.wasmSha256}</code></dd></>}</>}
			<dt>Request ID</dt><dd><code>{value.id}</code></dd>
			<dt>Saved</dt><dd><LocalDateTime dateTime={value.submittedAt} /></dd>
			{value.status === 'checking' ? <><dt>Result retention</dt><dd>30 days after the check finishes</dd></>
				: <><dt>Retained until</dt><dd><LocalDateTime dateTime={value.expiresAt} /></dd></>}
		</dl>
		<p><a href={'/developer/verification?submission=' + value.id}>Open this saved request</a> · Only available to the GitHub account that saved it.</p>
		<p>GitHub sign-in identifies the submitter, not ownership of this contract or repository.
			{' '}This checks published attestations; independent source reproduction and a security audit are not assessed.</p>
		{evidence && <details><summary>Observation scope</summary><p>Network: {value.networkPassphrase}.
			{' '}The ledger is an RPC observation, not an independent ledger-state proof.</p></details>}
	</section>;
}
