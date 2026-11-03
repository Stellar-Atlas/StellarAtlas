'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { requestExplorerJson } from '../../api/explorer-analytics';
import type { TransferActivityPage } from '../../api/transfer-activity';
import type { Asset } from './explorer-asset-types';
import { assetActivityHref, assetActivityPath, parseAssetActivityPage, readAssetActivitySelection, type AssetActivitySelection } from './asset-activity-page';

export function useAssetTransferActivity(asset: Asset) {
	const pathname = usePathname(), search = useSearchParams().toString();
	let selection: AssetActivitySelection | null = null, routeError: string | null = null;
	try { selection = readAssetActivitySelection(new URLSearchParams(search), asset); }
	catch (cause) { routeError = cause instanceof Error ? cause.message : 'Invalid activity selection.'; }
	const before = selection?.before, after = selection?.after ?? null, valid = selection !== null;
	const [attempt,setAttempt]=useState(0);
	const selectionKey=JSON.stringify([before,after]);
	const requestKey=JSON.stringify([asset.id,asset.kind,asset.contractId,valid,before,after,attempt]);
	const [loaded,setLoaded]=useState<{key:string;page:TransferActivityPage}|null>(null);
	const [failure,setFailure]=useState<{key:string;message:string}|null>(null), [settled,setSettled]=useState('');
	const active=useRef<AbortController|null>(null), generation=useRef(0);
	const previousPages=useRef(new Map<string,string|null>());
	useEffect(()=>{
		if(!valid) return;
		const abort=new AbortController(), version=++generation.current;
		active.current=abort;
		setLoaded(null);setFailure(null);setSettled('');
		const origin=window.location.pathname+window.location.search;
		const current=()=>!abort.signal.aborted && generation.current===version && origin===window.location.pathname+window.location.search;
		void (async()=>{
			try {
				const raw=await requestExplorerJson(assetActivityPath(asset,before,after),abort.signal);
				const page=parseAssetActivityPage(raw,asset,before,after);
				if(current()) setLoaded({key:requestKey,page});
			} catch(cause) {
				if(current()) setFailure({key:requestKey,message:cause instanceof Error?cause.message:'Activity unavailable.'});
			} finally {
				if(!abort.signal.aborted && generation.current===version) {
					active.current=null;setSettled(requestKey);
					if(!current()) setFailure({key:requestKey,message:'Activity context changed. Retry the request.'});
				}
			}
		})();
		return()=>{abort.abort();};
	},[requestKey]);
	const clear=():void=>{
		generation.current++;active.current?.abort();setLoaded(null);setFailure(null);
	};
	const change=(next:AssetActivitySelection|null):void=>{
		const href=assetActivityHref(pathname,window.location.search,asset,next,window.location.hash);
		clear();
		if(href!==window.location.pathname+window.location.search+window.location.hash) window.history.pushState(null,'',href);
		const effective=next??{before:asset.lastObservedLedger,after:null};
		if(valid&&JSON.stringify([effective.before,effective.after])===selectionKey) setAttempt(current=>current+1);
	};
	const cancel=():void=>{
		generation.current++;active.current?.abort();active.current=null;setLoaded(null);
		setFailure({key:requestKey,message:'Activity request cancelled.'});setSettled(requestKey);
	};
	const page=valid&&loaded?.key===requestKey?loaded.page:null;
	const previous=previousPages.current.get(selectionKey), next=page?.nextCursor;
	const originParams=new URLSearchParams(search);
	originParams.delete('return_to');
	return {page,error:routeError??(failure?.key===requestKey?failure.message:null),busy:valid&&settled!==requestKey,before,cancel,
		origin:page?assetActivityHref(pathname,originParams.toString(),asset,selection):pathname,
		retry:selection?()=>{clear();setAttempt(current=>current+1);}:null,
		window:(before:number|undefined)=>change(before===asset.lastObservedLedger?null:{before,after:null}),
		previous:valid&&after!==null&&previous!==undefined?()=>change({before,after:previous}):null,
		next:next?()=>{
			previousPages.current.set(JSON.stringify([before,next]),after);
			const oldest=previousPages.current.keys().next().value;
			if(previousPages.current.size>50&&oldest)previousPages.current.delete(oldest);
			change({before,after:next});
		}:null,
		first:()=>change(!valid||before===asset.lastObservedLedger?null:{before,after:null})
	};
}
