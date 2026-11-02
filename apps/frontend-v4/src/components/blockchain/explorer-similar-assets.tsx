'use client';
import { useMemo, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ExplorerLink as Link } from './explorer-investigation';
import { LocalDateTime } from '../local-date-time';
import { isClassicComparisonAsset, readSimilarCursor, similarAssetsHref, similarAssetSourceHref } from './similar-assets-page';
import { useSimilarAssetsPage } from './use-similar-assets-page';
import styles from './explorer-entity.module.css';

export function ExplorerSimilarAssets({asset}:{readonly asset:string}):React.JSX.Element {
	return isClassicComparisonAsset(asset)?<SimilarAssets key={asset} asset={asset}/>:<p className={styles.muted}>Same-symbol comparison is available for issued assets.</p>;
}
function SimilarAssets({asset}:{readonly asset:string}):React.JSX.Element {
	const pathname=usePathname(),params=useSearchParams(),search=params.toString();
	const route=useMemo(()=>{try{return {cursor:readSimilarCursor(new URLSearchParams(search),asset),error:null};}catch(failure){return {cursor:null,error:failure instanceof Error?failure.message:'Invalid comparison selection.'};}},[search,asset]);
	const state=useSimilarAssetsPage(asset,route.cursor,route.error===null),{page,busy}=state,error=route.error||state.error;
	const previousPages=useRef(new Map<string,string|null>()),previous=previousPages.current.get(route.cursor??'');
	const navigate=(cursor:string|null):void=>{
		const href=similarAssetsHref(pathname,window.location.search,asset,cursor,window.location.hash);
		if(href===window.location.pathname+window.location.search+window.location.hash)state.retry();
		else{state.cancel();window.history.pushState(null,'',href);}
	};
	return <section className={styles.panel} aria-label="Same-symbol asset comparison" aria-busy={busy}>
		<h3>Other assets with the same symbol</h3>
		<p className={styles.muted}>Compare issuers. A matching symbol does not establish authenticity.</p>
		{busy&&<p role="status">Loading same-symbol assets…</p>}
		{error&&<p role="alert" className={styles.error}>{error}{!route.error&&<button type="button" disabled={busy} onClick={state.retry}>Retry comparison</button>}</p>}
		{page&&<>
			<p className={styles.muted}>{page.rows.length} on this page{page.generatedAt&&<> · catalog <LocalDateTime dateTime={page.generatedAt}/></>}</p>
			{page.rows.length>0?<div className={styles.tableWrap}><table className={styles.table}>
				<thead><tr><th scope="col">Asset</th><th scope="col">Issuer</th><th scope="col">Identity source</th></tr></thead>
				<tbody>{page.rows.map(row=>{
					const source=similarAssetSourceHref(row.source);
					return <tr key={row.id}>
						<td data-label="Asset"><div><Link href={'/explorer/assets/'+encodeURIComponent(row.id)}>{row.code}</Link></div></td>
						<td data-label="Issuer"><div><Link className={styles.hash} href={'/explorer/issuers/'+row.issuer}>{row.issuer}</Link></div></td>
						<td data-label="Identity source"><div>{source?<a href={source} target="_blank" rel="noopener noreferrer">Project reference</a>:row.source?'Reference unavailable':'Not supplied'}</div></td>
					</tr>;
				})}</tbody>
			</table></div>:<p>{page.generatedAt===null?'Asset catalog is not available yet.':'No other assets returned on this page.'}</p>}
		</>}
		<div className={styles.actions}>
			{busy&&<button type="button" onClick={state.cancel}>Cancel comparison</button>}
			<button type="button" disabled={busy||previous===undefined} onClick={()=>previous!==undefined&&navigate(previous)}>Previous comparison</button>
			<button type="button" disabled={busy||!page?.next} onClick={()=>{
				if(!page?.next)return;
				previousPages.current.set(page.next,route.cursor);
				const oldest=previousPages.current.keys().next().value;
				if(previousPages.current.size>50&&oldest)previousPages.current.delete(oldest);
				navigate(page.next);
			}}>Next comparison</button>
			<button type="button" disabled={busy||(!route.cursor&&!route.error)} onClick={()=>navigate(null)}>First comparison page</button>
		</div>
	</section>;
}
