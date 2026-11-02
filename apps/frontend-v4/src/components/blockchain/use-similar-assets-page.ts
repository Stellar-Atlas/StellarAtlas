'use client';
import { useEffect, useRef, useState } from 'react';
import { requestExplorerJson } from '../../api/explorer-analytics';
import { parseSimilarAssetsPage, similarAssetsPath, type SimilarAssetsPage } from './similar-assets-page';
interface State { readonly key:string; readonly page:SimilarAssetsPage|null; readonly error:string|null; readonly busy:boolean }
export function useSimilarAssetsPage(asset:string,cursor:string|null,enabled:boolean) {
	const [attempt,setAttempt]=useState(0),[state,setState]=useState<State|null>(null);
	const key=JSON.stringify([asset,cursor,enabled,attempt]),active=useRef<AbortController|null>(null),generation=useRef(0);
	useEffect(()=>{
		if(!enabled)return;
		const controller=new AbortController(),version=++generation.current;
		active.current=controller;
		const origin=window.location.pathname+window.location.search;
		const current=()=>!controller.signal.aborted&&version===generation.current&&origin===window.location.pathname+window.location.search;
		setState({key,page:null,error:null,busy:true});
		void(async()=>{
			try{
				const page=parseSimilarAssetsPage(await requestExplorerJson(similarAssetsPath(asset,cursor),controller.signal),asset,cursor);
				if(current())setState({key,page,error:null,busy:false});
			}catch(failure){
				if(current())setState({key,page:null,error:failure instanceof Error?failure.message:'Asset comparison unavailable.',busy:false});
			}finally{
				if(!controller.signal.aborted&&version===generation.current){
					active.current=null;
					if(!current())setState({key,page:null,error:'Comparison context changed. Retry the request.',busy:false});
				}
			}
		})();
		return()=>controller.abort();
	},[key]);
	const cancel=():void=>{generation.current++;active.current?.abort();active.current=null;setState({key,page:null,error:'Comparison request cancelled.',busy:false});};
	const view=state?.key===key?state:{page:null,error:null,busy:enabled};
	return {...view,cancel,retry:()=>setAttempt(value=>value+1)};
}
