import { fetchValidatedJson } from '@api/http-client';
import { PageHeading } from '@components/layout/page-heading';
import { isClassicAccount, isContractAccount } from '@domain/classic-account';
import {
	MAX_SOROBAN_DOMAIN_NAME_LENGTH,
	normalizeSorobanDomainName
} from '@domain/soroban-domain-name';
import styles from '@components/blockchain/explorer-entity.module.css';
import ui from '@components/blockchain/explorer-asset-workspace.module.css';

type DomainResult =
	| {
			status: 'resolved';
			address: string;
			addressKind: 'account' | 'contract';
			expiresAt: string;
			ledger: number;
	  }
	| { status: 'not_found' | 'expired' };

function parseLookup(value: unknown, name: string): DomainResult | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('name' in value) ||
		value.name !== name ||
		!('source' in value) ||
		value.source !== 'creit-soroban-domains-v2' ||
		!('network' in value) ||
		value.network !== 'mainnet' ||
		!('observedLedger' in value) ||
		typeof value.observedLedger !== 'number' ||
		!Number.isSafeInteger(value.observedLedger) ||
		value.observedLedger < 1 ||
		!('status' in value)
	)
		return null;

	if (value.status === 'not_found' || value.status === 'expired')
		return { status: value.status };
	if (value.status !== 'resolved' || !('record' in value)) return null;

	const record = value.record;
	if (
		typeof record !== 'object' ||
		record === null ||
		!('address' in record) ||
		typeof record.address !== 'string' ||
		!('addressKind' in record) ||
		!('expiresAt' in record) ||
		typeof record.expiresAt !== 'number' ||
		!Number.isSafeInteger(record.expiresAt) ||
		record.expiresAt > 8_640_000_000_000
	)
		return null;
	const { address, addressKind, expiresAt } = record;
	if (
		!(addressKind === 'account' && isClassicAccount(address)) &&
		!(addressKind === 'contract' && isContractAccount(address))
	)
		return null;
	if (expiresAt * 1000 <= Date.now()) return { status: 'expired' };
	return {
		status: 'resolved',
		address,
		addressKind,
		expiresAt: new Date(expiresAt * 1000).toISOString(),
		ledger: value.observedLedger
	};
}

async function lookupDomain(
	name: string
): Promise<DomainResult | { status: 'unavailable' }> {
	try {
		return await fetchValidatedJson(
			'/v1/soroban-domains/' + encodeURIComponent(name),
			(value) => parseLookup(value, name),
			{ cache: 'no-store', timeoutMs: 12_000 }
		);
	} catch {
		return { status: 'unavailable' };
	}
}

export default async function ExplorerSorobanDomainsPage({
	searchParams
}: {
	readonly searchParams: Promise<{ name?: string | string[] }>;
}): Promise<React.JSX.Element> {
	const { name: query } = await searchParams;
	const input =
		typeof query === 'string' && query.length <= MAX_SOROBAN_DOMAIN_NAME_LENGTH
			? query.trim()
			: '';
	const name = normalizeSorobanDomainName(input);
	const result = name === null ? null : await lookupDomain(name);

	return (
		<main className="shell">
			<PageHeading
				title="Soroban Domains"
				eyebrow="Explorer"
				description="Look up an exact .xlm name in the Creit Tech Soroban Domains registry on Stellar mainnet."
			/>
			<section className={styles.panel} aria-label="Soroban Domains lookup">
				<form
					className={ui.search}
					method="get"
					action="/explorer/soroban-domains"
				>
					<input
						aria-label="Soroban Domains name"
						name="name"
						defaultValue={input}
						placeholder="example.xlm"
						maxLength={MAX_SOROBAN_DOMAIN_NAME_LENGTH}
						required
					/>
					<button type="submit">Look up name</button>
				</form>
				{query !== undefined && name === null && (
					<p className={styles.error} role="alert">
						Enter a .xlm name with one to four alphabetic labels of at most 15
						letters each.
					</p>
				)}
				{result?.status === 'not_found' && (
					<p role="status">No registry record for {name}.</p>
				)}
				{result?.status === 'expired' && (
					<p role="status">
						The registry record for {name} has expired or is stale.
					</p>
				)}
				{result?.status === 'unavailable' && (
					<p className={styles.error} role="alert">
						Registry lookup is currently unavailable.
					</p>
				)}
				{result?.status === 'resolved' && (
					<>
						<h2>{name}</h2>
						<p className={styles.muted}>
							Registry destination observed at mainnet ledger{' '}
							{result.ledger.toLocaleString('en-US')}.
						</p>
						<p>
							<a
								className={ui.plainHash}
								href={
									(result.addressKind === 'account'
										? '/explorer/accounts/'
										: '/explorer/contracts/') + result.address
								}
							>
								{result.address}
							</a>
						</p>
						<p className={styles.muted}>
							Root record expires{' '}
							<time dateTime={result.expiresAt}>{result.expiresAt}</time>.
						</p>
					</>
				)}
			</section>
		</main>
	);
}
