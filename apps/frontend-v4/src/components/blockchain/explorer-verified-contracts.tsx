import {
	catalogueQueryLimit,
	contractCatalogueNetwork,
	contractVerificationGuidePath,
	verifiedContractsHref,
	verifiedContractsPath,
	type CatalogueQuery,
	type CatalogueResult,
	type ContractCatalogue,
	type ContractCatalogueItem
} from '@api/verified-contract-catalogue';
import { publicNetworkPassphrase } from '@api/explorer-current-account-snapshot';
import { withExplorerReturnTo } from '@api/explorer-return-context';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-verified-contracts.module.css';
import entity from './explorer-entity.module.css';

export function VerifiedContractFilters({ query }: {
	readonly query: CatalogueQuery | null;
}): React.JSX.Element {
	const limit = query?.limit ?? 25;
	const sizes = [...new Set([10, 25, 50, limit])].sort((a, b) => a - b);
	return (
		<section className={entity.panel} aria-label="Search verified contracts">
			<form className={styles.filters} action={verifiedContractsPath} method="get">
				<label>
					<span>Contract or source repository</span>
					<input type="search" name="q" defaultValue={query?.q ?? ''} maxLength={catalogueQueryLimit}
						placeholder="C-address or owner/repository" spellCheck={false} autoComplete="off" />
				</label>
				<label>
					<span>Per page</span>
					<select name="limit" defaultValue={limit}>
						{sizes.map((size) => <option key={size} value={size}>{size}</option>)}
					</select>
				</label>
				<button type="submit">Search</button>
			</form>
			{(query?.q || query?.cursor || (query && query.limit !== 25)) && (
				<p><a href={verifiedContractsPath}>Clear filters</a></p>
			)}
			{!query && (
				<p role="alert" className={entity.error}>
					Invalid search or page link. Enter a full contract address or a GitHub owner/repository prefix, or{' '}
					<a href={verifiedContractsPath}>start at the first page</a>.
				</p>
			)}
		</section>
	);
}

function VerifiedContractRow({ row, mainnet, origin }: {
	readonly row: ContractCatalogueItem;
	readonly mainnet: boolean;
	readonly origin: string;
}): React.JSX.Element {
	const detail = withExplorerReturnTo('/explorer/contracts/' + row.contractId, origin) + '#build-provenance';
	const ledger = withExplorerReturnTo('/explorer/ledgers/' + row.observedLedger, origin);
	const ledgerLabel = row.observedLedger.toLocaleString('en-US');
	return (
		<li className={styles.row}>
			<div className={styles.rowHead}>
				<div>
					<h3>{row.source.repository}</h3>
					<div className={styles.address}>
						{mainnet ? <a href={detail}><code>{row.contractId}</code></a> : <code>{row.contractId}</code>}
					</div>
				</div>
				<span className={styles.attested}>Build attested</span>
			</div>
			<dl className={styles.identities}>
				<div><dt>Source commit</dt><dd><a href={row.source.url} rel="noreferrer"><code>{row.source.commit}</code></a></dd></div>
				<div><dt>Wasm SHA-256</dt><dd><code>{row.wasmSha256}</code></dd></div>
				<div><dt>Checked</dt><dd><LocalDateTime dateTime={row.checkedAt} /></dd></div>
				<div><dt>Observed ledger</dt><dd>{mainnet ? <a href={ledger}>{ledgerLabel}</a> : ledgerLabel}</dd></div>
			</dl>
			<ul className={styles.evidence} aria-label="Other evidence">
				<li>Source reproduction: <strong>Not assessed</strong></li>
				<li>Security audit: <strong>Not assessed</strong></li>
			</ul>
		</li>
	);
}

function VerifiedContractRows({ catalogue, query }: {
	readonly catalogue: ContractCatalogue;
	readonly query: CatalogueQuery;
}): React.JSX.Element {
	const origin = verifiedContractsHref(query);
	const firstPage = verifiedContractsHref({ ...query, cursor: null });
	const mainnet = catalogue.networkPassphrase === publicNetworkPassphrase;
	const { items, nextCursor } = catalogue;
	return (
		<section className={entity.panel} aria-labelledby="verified-contract-results">
			<header className={styles.resultsHead}>
				<h2 id="verified-contract-results">Catalogue results</h2>
				<span className={styles.network}>{contractCatalogueNetwork(catalogue.networkPassphrase)}</span>
			</header>
			<p className={entity.muted}>Recorded checks only. A contract can change after it was checked; an attestation does not prove ownership or safety.</p>
			{!mainnet && <p className={entity.muted}>Contract and ledger detail links are available for Mainnet records only.</p>}
			{items.length ? (
				<>
					<p className={entity.muted}>{items.length + (items.length === 1 ? ' contract' : ' contracts') + ' on this page'}</p>
					<ul className={styles.rows} aria-label="Contracts with build attestations">
						{items.map((row) => <VerifiedContractRow key={row.contractId} row={row} mainnet={mainnet} origin={origin} />)}
					</ul>
				</>
			) : (
				<p role="status">{query.cursor ? 'No records remain on this page.' : query.q
					? 'No recorded attestations match this search.' : 'No build attestations are recorded for this network yet.'}</p>
			)}
			{(query.cursor || nextCursor) && (
				<nav aria-label="Verified contract pages" className={styles.pagination}>
					{query.cursor && <a href={firstPage}>First page</a>}
					{nextCursor && <a href={verifiedContractsHref({ ...query, cursor: nextCursor })}>Next page →</a>}
				</nav>
			)}
		</section>
	);
}

export function VerifiedContractResults({ result, query }: {
	readonly result: CatalogueResult;
	readonly query: CatalogueQuery;
}): React.JSX.Element {
	if (result.kind === 'ready') return <VerifiedContractRows catalogue={result.catalogue} query={query} />;
	const rejected = result.kind === 'query_rejected';
	return (
		<section className={entity.panel} aria-label="Catalogue results">
			<p role="alert">{rejected ? (query.cursor ? 'This page link is no longer valid for the search.' : 'The catalogue could not use these search filters.')
				: 'The verified-contract catalogue is unavailable right now.'}</p>
			<p><a href={rejected ? verifiedContractsHref({ ...query, cursor: null, q: query.cursor ? query.q : '' }) : verifiedContractsHref(query)}>
				{rejected ? 'Return to the first page' : 'Try again'}
			</a></p>
		</section>
	);
}

export function VerificationGuideLink(): React.JSX.Element {
	return <a className={styles.guide} href={contractVerificationGuidePath}>Contract verification guide</a>;
}
