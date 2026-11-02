import { recordValue } from '../../api/explorer-analytics';
export interface SimilarAssetRow { readonly id:string; readonly code:string; readonly issuer:string; readonly source:string|null }
export interface SimilarAssetsPage { readonly rows:readonly SimilarAssetRow[]; readonly next:string|null; readonly generatedAt:string|null }
const validCursor=(value:string):boolean=>/^[A-Za-z0-9_-]{1,2048}$/.test(value);
export function isClassicComparisonAsset(asset:string):boolean {
	const parts=asset.split(':');
	return parts.length===2 && Boolean(parts[0]) && parts[0]!.length<=12 && /^G[A-Z2-7]{55}$/.test(parts[1]??'');
}
export function readSimilarCursor(params:Pick<URLSearchParams,'get'|'getAll'>,asset:string):string|null {
	if(['similar_after','similar_for'].some(key=>params.getAll(key).length>1)) throw new Error('Comparison parameters must not repeat.');
	const cursor=params.get('similar_after');
	if(cursor!==null ? !validCursor(cursor)||params.get('similar_for')!==asset : params.get('similar_for')!==null) throw new Error('This continuation belongs to a different asset. Return to the first page.');
	return cursor;
}
export function similarAssetsHref(pathname:string,search:string,asset:string,cursor:string|null,hash=''):string {
	const params=new URLSearchParams(search);
	params.delete('similar_after');params.delete('similar_for');
	if(cursor!==null){params.set('similar_after',cursor);params.set('similar_for',asset);}
	readSimilarCursor(params,asset);
	return pathname+(params.size?'?'+params:'')+hash;
}
export function similarAssetsPath(asset:string,cursor:string|null):string {
	if(!isClassicComparisonAsset(asset)||(cursor!==null&&!validCursor(cursor))) throw new Error('A classic asset identity and valid continuation are required.');
	return '/v1/assets/'+encodeURIComponent(asset)+'/similar?'+new URLSearchParams({limit:'25',...(cursor===null?{}:{cursor})});
}
export function parseSimilarAssetsPage(value:unknown,asset:string,cursor:string|null):SimilarAssetsPage {
	similarAssetsPath(asset,cursor);
	const data=recordValue(value),reference=recordValue(data.asset),code=asset.split(':')[0];
	if(reference.id!==asset || !Array.isArray(data.data)||data.data.length>25 ||
		!(data.nextCursor===null||typeof data.nextCursor==='string'&&validCursor(data.nextCursor)&&data.nextCursor!==cursor)||
		!(data.generatedAt===null||typeof data.generatedAt==='string'&&Number.isFinite(Date.parse(data.generatedAt)))) throw new Error('Invalid or unrelated asset comparison page.');
	const seen=new Set<string>();
	const rows=data.data.map(value=>{
		const row=recordValue(value);
		if(row.kind!=='classic'||row.code!==code||typeof row.issuer!=='string'||!/^G[A-Z2-7]{55}$/.test(row.issuer)||
			typeof row.id!=='string'||row.id!==row.code+':'+row.issuer||row.id===asset||seen.has(row.id)||
			!(row.source===null||typeof row.source==='string'&&row.source.length<=2048)) throw new Error('Invalid same-symbol asset record.');
		seen.add(row.id);
		return {id:row.id,code:row.code as string,issuer:row.issuer,source:row.source as string|null};
	});
	return {rows,next:data.nextCursor as string|null,generatedAt:data.generatedAt as string|null};
}
export function similarAssetSourceHref(source:string|null):string|null {
	if(!source)return null;
	try{const url=new URL(source);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.toString():null;}catch{return null;}
}
