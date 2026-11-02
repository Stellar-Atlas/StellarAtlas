import { recordValue } from '../../api/explorer-analytics';
export interface IssuerSelection { readonly q:string; readonly cursor:string|null }
export interface IssuerRow { readonly id:string; readonly homeDomain:string|null; readonly assetCount:number }
export interface IssuerPage { readonly rows:readonly IssuerRow[]; readonly next:string|null; readonly domainsReady:boolean; readonly generatedAt:string|null }
const cursorValid=(value:string):boolean=>/^[A-Za-z0-9_-]{1,2048}$/.test(value);
export function readIssuerSelection(params:Pick<URLSearchParams,'get'|'getAll'>):IssuerSelection {
	if(['q','cursor','cursor_for'].some(key=>params.getAll(key).length>1)) throw new Error('Issuer search parameters must not repeat.');
	const q=(params.get('q')??'').trim(), cursor=params.get('cursor');
	if(q.length>2048 || /[\u0000-\u001f\u007f]/.test(q)) throw new Error('Enter an issuer address or home domain.');
	if(cursor !== null ? !cursorValid(cursor)||params.get('cursor_for')!==q : params.get('cursor_for')!==null) throw new Error('This continuation does not match the issuer search. Return to the first page.');
	return {q,cursor};
}
export const issuerSelectionKey=(selection:IssuerSelection):string=>JSON.stringify([selection.q,selection.cursor]);
/** Recover a valid query from a stale cursor URL without issuing a widened request. */
export function issuerRecoveryQuery(search:string):string {
	const params=new URLSearchParams(search);
	params.delete('cursor');params.delete('cursor_for');
	try{return readIssuerSelection(params).q;}catch{return '';}
}
export function issuerDirectoryHref(pathname:string,search:string,selection:IssuerSelection,hash=''):string {
	const params=new URLSearchParams(search);
	for(const key of ['q','cursor','cursor_for']) params.delete(key);
	if(selection.q) params.set('q',selection.q);
	if(selection.cursor){params.set('cursor',selection.cursor);params.set('cursor_for',selection.q);}
	readIssuerSelection(params);
	return pathname+(params.size?'?'+params:'')+hash;
}
export function issuerDirectoryPath(selection:IssuerSelection):string {
	const validation=new URLSearchParams({q:selection.q});
	if(selection.cursor!==null){validation.set('cursor',selection.cursor);validation.set('cursor_for',selection.q);}
	readIssuerSelection(validation);
	const params=new URLSearchParams({q:selection.q,limit:'25'});
	if(selection.cursor) params.set('cursor',selection.cursor);
	return '/v1/issuers?'+params;
}
export function parseIssuerPage(value:unknown,cursor:string|null):IssuerPage {
	const data=recordValue(value);
	if(!Array.isArray(data.data)||data.data.length>25||typeof data.domainsReady!=='boolean'||
		!(data.generatedAt===null || typeof data.generatedAt==='string'&&Number.isFinite(Date.parse(data.generatedAt)))||
		!(data.nextCursor===null || typeof data.nextCursor==='string'&&cursorValid(data.nextCursor)&&data.nextCursor!==cursor&&data.data.length>0)) throw new Error('Invalid issuer page or continuation.');
	const seen=new Set<string>();
	const rows=data.data.map(value=>{
		const row=recordValue(value);
		if(typeof row.id!=='string'||!/^G[A-Z2-7]{55}$/.test(row.id)||seen.has(row.id)||
			typeof row.assetCount!=='number'||!Number.isSafeInteger(row.assetCount)||row.assetCount<0||
			!(row.homeDomain===null || typeof row.homeDomain==='string'&&row.homeDomain.length<=2048&&!/[\u0000-\u001f\u007f]/.test(row.homeDomain))) throw new Error('Invalid issuer row.');
		seen.add(row.id);
		return {id:row.id,assetCount:row.assetCount,homeDomain:row.homeDomain};
	});
	return {rows,next:data.nextCursor as string|null,domainsReady:data.domainsReady,generatedAt:data.generatedAt as string|null};
}
