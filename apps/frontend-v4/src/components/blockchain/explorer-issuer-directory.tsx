'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LocalDateTime } from '../local-date-time';
import { readIssuerSelection, issuerDirectoryHref, issuerSelectionKey, issuerRecoveryQuery, type IssuerSelection } from './issuer-directory-page';
import { useIssuerDirectoryPage } from './use-issuer-directory-page';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

export function ExplorerIssuerDirectory(): React.JSX.Element {
	const pathname=usePathname(),params=useSearchParams(),search=params.toString();
	const route=useMemo(()=>{try{return {selection:readIssuerSelection(new URLSearchParams(search)),error:null};}catch(failure){return {selection:null,error:failure instanceof Error?failure.message:'Invalid issuer search.'};}},[search]);
	const selection=route.selection, state=useIssuerDirectoryPage(selection), {page,busy}=state;
	const [inputError,setInputError]=useState<string|null>(null);
	const error=route.error||state.error||inputError;
	const restoredQuery=selection?.q??issuerRecoveryQuery(search);
	const [query,setQuery]=useState(restoredQuery);
	useEffect(()=>setQuery(restoredQuery),[restoredQuery]);
	const previousPages=useRef(new Map<string,IssuerSelection>());
	const previous=selection?previousPages.current.get(issuerSelectionKey(selection)):undefined;
	const navigate=(next:IssuerSelection):void=>{
		try {
			const href=issuerDirectoryHref(pathname,window.location.search,next,window.location.hash);
			const sameSelection=selection!==null&&issuerSelectionKey(selection)===issuerSelectionKey(next);
			const sameHref=href===window.location.pathname+window.location.search+window.location.hash;
			setInputError(null);
			if(sameSelection&&page){
				if(!sameHref) window.history.pushState(null,'',href);
				return;
			}
			if(sameHref) state.retry();
			else {
				state.cancel();window.history.pushState(null,'',href);
				if(sameSelection) state.retry();
			}
		} catch(failure) {setInputError(failure instanceof Error?failure.message:'Invalid issuer search.');}
	};
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="issuers" />
			<section className={styles.panel} aria-label="Issuer directory" aria-busy={busy}>
				<form
					className={ui.search}
					onSubmit={(event) => {
						event.preventDefault();
						navigate({q:query.trim(),cursor:null});
					}}
				>
					<input
						aria-label="Search issuers"
						maxLength={2048}
						placeholder="Issuer G-address or home domain"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
					<button type="submit" disabled={busy}>
						{busy ? 'Searching…' : 'Search issuers'}
					</button>
					{busy && <button type="button" onClick={state.cancel}>Cancel issuer search</button>}
				</form>
				{busy && <p role="status">Loading issuers…</p>}
				{error && (
					<p className={styles.error} role="alert">
						{error}
						{selection && <button type="button" disabled={busy} onClick={state.retry}>Retry issuers</button>}
					</p>
				)}
				{page && (
					<>
						<p className={styles.muted}>{page.rows.length} issuers on this page{page.generatedAt && <> · catalog <LocalDateTime dateTime={page.generatedAt} /></>}</p>
						<div className={styles.tableWrap}>
							<table className={styles.table}>
								<thead>
									<tr>
										<th scope="col">Home domain</th>
										<th scope="col">Issuer</th>
										<th scope="col" className={ui.numeric}>Indexed assets</th>
									</tr>
								</thead>
								<tbody>
									{page.rows.map((row) => (
										<tr key={row.id}>
											<td data-label="Home domain"><div>
												<Link href={'/explorer/issuers/' + row.id}>
													{row.homeDomain || 'Not published / not indexed'}
												</Link>
											</div></td>
											<td data-label="Issuer"><div>
												<Link
													className={ui.plainHash}
													href={'/explorer/issuers/' + row.id}
												>
													{row.id}
												</Link>
											</div></td>
											<td data-label="Indexed assets" className={ui.numeric}><div>
												<Link href={'/explorer/issuers/' + row.id}>
													{row.assetCount.toLocaleString()}
												</Link>
											</div></td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{!page.rows.length && (
							<p className={styles.muted}>{page.generatedAt === null ? 'Issuer catalog is not available yet.' : 'No matching indexed issuers.'}</p>
						)}
							{!page.domainsReady && (
								<span className={ui.observationLabel}>
									Home domain coverage is incomplete.
								</span>
							)}
					</>
				)}
				<div className={styles.actions}>
					<button type="button" disabled={busy||!previous} onClick={()=>previous&&navigate(previous)}>Previous page</button>
					<button type="button" disabled={busy||!page?.next||!selection} onClick={()=>{
						if(!selection||!page?.next)return;
						const next={...selection,cursor:page.next};
						previousPages.current.set(issuerSelectionKey(next),selection);
						const oldest=previousPages.current.keys().next().value;
						if(previousPages.current.size>50&&oldest)previousPages.current.delete(oldest);
						navigate(next);
					}}>Next page</button>
					<button type="button" disabled={busy||(!selection?.cursor&&!route.error)} onClick={()=>navigate({q:selection?.q??query.trim(),cursor:null})}>First page</button>
				</div>
			</section>
		</div>
	);
}
