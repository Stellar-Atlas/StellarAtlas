import type { PublicOrganization } from '../../api/types';
import { formatDateTime } from '../../format/formatters';

const TLS_WARNING = 'TlsCertificateVerificationDisabled';

export function OrganizationTomlEvidence({
	organization
}: {
	readonly organization: PublicOrganization;
}): React.JSX.Element {
	const latestAttempt = organization.tomlLatestAttempt ?? null;
	const latestFailure = organization.tomlLatestFailure ?? null;
	const latestInsecureAttempt =
		organization.tomlLatestInsecureAttempt ??
		(latestAttempt?.warnings.includes(TLS_WARNING) ? latestAttempt : null);
	const stellarToml = organization.stellarToml;
	const tomlUrl =
		stellarToml?.url ??
		`https://${organization.homeDomain}/.well-known/stellar.toml`;
	const latestAttemptFailed = latestAttempt?.result === 'failure';
	const latestAttemptQuarantined =
		latestAttempt?.result === 'success' &&
		(latestAttempt.authoritative === false ||
			latestAttempt.warnings.includes(TLS_WARNING));
	const retainedLegacyTlsWarning =
		stellarToml?.warnings?.includes(TLS_WARNING) ?? false;
	const retainedSuccessHasProvenance = stellarToml?.observedAt !== undefined;

	return (
		<article className="panel detail-panel organization-toml-evidence">
			<div className="panel-heading">
				<h2>Organization stellar.toml</h2>
				<span className="muted-inline">
					{latestAttempt?.state ?? organization.tomlState}
				</span>
			</div>
			<div className="toml-evidence-grid">
				<EvidenceFact
					detail={
						latestAttemptQuarantined
							? `${latestAttempt?.state ?? organization.tomlState}; quarantined`
							: (latestAttempt?.state ?? organization.tomlState)
					}
					label="Latest fetch attempt"
					observedAt={latestAttempt?.observedAt}
					value={formatAttemptResult(latestAttempt?.result)}
					warnings={latestAttempt?.warnings ?? organization.tomlWarnings}
				/>
				<EvidenceFact
					detail={
						stellarToml === null
							? 'No successful document retained'
							: retainedLegacyTlsWarning
								? 'Legacy TLS-fallback content; non-authoritative'
								: retainedSuccessHasProvenance
									? 'Authoritative certificate-verified content'
									: 'Legacy retained content; provenance unavailable'
					}
					label="Last persisted success"
					observedAt={stellarToml?.observedAt ?? undefined}
					value={stellarToml === null ? 'Not recorded' : 'Stored'}
					warnings={stellarToml?.warnings ?? []}
				/>
				<EvidenceFact
					detail={latestFailure?.state ?? 'No failed attempt retained'}
					label="Retained failure"
					observedAt={latestFailure?.observedAt}
					value={latestFailure === null ? 'None' : 'Failed'}
					warnings={latestFailure?.warnings ?? []}
				/>
				<EvidenceFact
					detail={latestInsecureAttempt?.state ?? 'No TLS fallback retained'}
					label="Retained TLS fallback"
					observedAt={latestInsecureAttempt?.observedAt}
					value={latestInsecureAttempt === null ? 'None' : 'Quarantined'}
					warnings={latestInsecureAttempt?.warnings ?? []}
				/>
			</div>
			{latestAttemptFailed && stellarToml !== null ? (
				<p className="toml-evidence-notice warning">
					The latest fetch failed. The document below is retained from the last
					successful fetch.
				</p>
			) : null}
			{latestAttemptQuarantined ? (
				<p className="toml-evidence-notice warning">
					The latest document parsed only after TLS verification was disabled.
					It is retained as evidence and was not used for organization metadata,
					validator ownership, or archive targets.
				</p>
			) : null}
			{latestInsecureAttempt !== null && !latestAttemptQuarantined ? (
				<p className="toml-evidence-notice warning">
					A TLS certificate warning remains retained from the fetch at{' '}
					{formatDateTime(latestInsecureAttempt.observedAt)}. Its response was
					quarantined from authoritative metadata.
				</p>
			) : null}
			{retainedLegacyTlsWarning ? (
				<p className="toml-evidence-notice warning">
					This legacy persisted document carries a TLS fallback warning. It is
					displayed as retained evidence, not trusted metadata.
				</p>
			) : null}
			<details className="metadata-document">
				<summary>
					<span>Last persisted stellar.toml</span>
					<a href={tomlUrl} rel="noopener noreferrer" target="_blank">
						{tomlUrl}
					</a>
				</summary>
				{stellarToml ? (
					<pre>{stellarToml.content}</pre>
				) : (
					<p className="muted-copy">
						No successful stellar.toml document has been persisted.
					</p>
				)}
			</details>
		</article>
	);
}

function EvidenceFact({
	detail,
	label,
	observedAt,
	value,
	warnings
}: {
	readonly detail: string;
	readonly label: string;
	readonly observedAt?: string;
	readonly value: string;
	readonly warnings: readonly string[];
}): React.JSX.Element {
	const usedTlsFallback = warnings.includes(TLS_WARNING);

	return (
		<section className="toml-evidence-fact">
			<span>{label}</span>
			<strong>{value}</strong>
			<small>
				{observedAt ? formatDateTime(observedAt) : 'Time unavailable'}
			</small>
			<small>{detail}</small>
			{usedTlsFallback ? (
				<small className="toml-warning">TLS verification disabled</small>
			) : null}
		</section>
	);
}

function formatAttemptResult(
	result: 'failure' | 'success' | undefined
): string {
	if (result === 'success') return 'Succeeded';
	if (result === 'failure') return 'Failed';
	return 'Not recorded';
}
