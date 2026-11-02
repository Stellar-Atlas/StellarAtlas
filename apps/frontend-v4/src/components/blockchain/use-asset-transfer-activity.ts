'use client';
import { useEffect, useRef, useState } from 'react';
import { requestExplorerJson } from '../../api/explorer-analytics';
import type { TransferActivityPage } from '../../api/transfer-activity';
import type { Asset } from './explorer-asset-types';
import { assetActivityPath, parseAssetActivityPage } from './asset-activity-page';

export function useAssetTransferActivity(asset: Asset) {
	const [selection,setSelection]=useState({before:asset.lastObservedLedger,after:null as string|null,history:[] as (string|null)[],attempt:0});
	const requestKey=JSON.stringify([asset.id,asset.kind,asset.contractId,selection.before,selection.after,selection.attempt]);
	const [loaded,setLoaded]=useState<{key:string;page:TransferActivityPage}|null>(null);
	const [failure,setFailure]=useState<{key:string;message:string}|null>(null), [settled,setSettled]=useState('');
	const active=useRef<AbortController|null>(null), generation=useRef(0);
	useEffect(()=>{
		const abort=new AbortController(), version=++generation.current;
		active.current=abort;
		const origin=window.location.pathname+window.location.search;
		const current=()=>!abort.signal.aborted && generation.current===version && origin===window.location.pathname+window.location.search;
		void (async()=>{
			try {
				const raw=await requestExplorerJson(assetActivityPath(asset,selection.before,selection.after),abort.signal);
				const page=parseAssetActivityPage(raw,asset,selection.before,selection.after);
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
	const change=(next:Omit<typeof selection,'attempt'>):void=>{
		generation.current++;active.current?.abort();setLoaded(null);setFailure(null);
		setSelection(current=>({...next,attempt:current.attempt+1}));
	};
	const cancel=():void=>{
		generation.current++;active.current?.abort();active.current=null;setLoaded(null);
		setFailure({key:requestKey,message:'Activity request cancelled.'});setSettled(requestKey);
	};
	const page=loaded?.key===requestKey?loaded.page:null;
	return {page,error:failure?.key===requestKey?failure.message:null,busy:settled!==requestKey,before:selection.before,cancel,
		retry:()=>change(selection),
		window:(before:number|undefined)=>change({before,after:null,history:[]}),
		previous:selection.history.length?()=>change({...selection,after:selection.history.at(-1)??null,history:selection.history.slice(0,-1)}):null,
		next:page?.nextCursor?()=>change({...selection,after:page.nextCursor,history:[...selection.history,selection.after].slice(-50)}):null,
		first:()=>change({...selection,after:null,history:[]})
	};
}
