import { issuerDirectoryHref, issuerDirectoryPath, issuerSelectionKey, issuerRecoveryQuery, parseIssuerPage, readIssuerSelection } from '../issuer-directory-page';
const row={id:'G'+'A'.repeat(55),homeDomain:'example.org',assetCount:9007199254740991};
const page={data:[row],nextCursor:'page_2',domainsReady:false,generatedAt:'2026-11-02T00:00:00Z'};
describe('bounded issuer directory selection',()=>{
	it('round trips query/cursor and retains unrelated return context and anchor',()=>{
		const selection={q:'example.org',cursor:'page_2'};
		const href=issuerDirectoryHref('/explorer/issuers','?return_to=%2Fexplorer&keep=1',selection,'#results');
		const url=new URL(href,'http://fixture.invalid');
		expect(readIssuerSelection(url.searchParams)).toEqual(selection);
		expect(url.searchParams.get('return_to')).toBe('/explorer');expect(url.hash).toBe('#results');
		expect(issuerDirectoryPath(selection)).toBe('/v1/issuers?q=example.org&limit=25&cursor=page_2');
		expect(issuerSelectionKey(selection)).not.toBe(issuerSelectionKey({...selection,q:'other.org'}));
		const reset=new URL(issuerDirectoryHref(url.pathname,url.search,{q:'other.org',cursor:null}),url);
		expect(reset.searchParams.has('cursor')).toBe(false);expect(reset.searchParams.has('cursor_for')).toBe(false);
	});
	it('blocks repeated, malformed, oversized and cross-query continuations without silently querying',()=>{
		for(const query of ['q=a&q=b','q=%00bad','q='+ 'x'.repeat(2049),'cursor=page_2','cursor_for=a','q=a&cursor=page_2&cursor_for=b','q=a&cursor=a%2B%2F%3D&cursor_for=a','q=a&cursor=page_2&cursor=page_3&cursor_for=a']) expect(()=>readIssuerSelection(new URLSearchParams(query))).toThrow();
		expect(()=>issuerDirectoryPath({q:'a',cursor:'x'.repeat(2049)})).toThrow();
		expect(issuerRecoveryQuery('?q=example.org&cursor=stale&cursor_for=other.org')).toBe('example.org');
		expect(issuerRecoveryQuery('?q=one&q=two&cursor=stale')).toBe('');
	});
	it('keeps one page, exact counts and incomplete-domain semantics',()=>{
		expect(parseIssuerPage(page,null)).toEqual({rows:[row],next:'page_2',domainsReady:false,generatedAt:page.generatedAt});
		expect(parseIssuerPage({...page,data:[],nextCursor:null,generatedAt:null},null).rows).toEqual([]);
	});
	it('rejects duplicate/oversized rows, unknown domains/counts and repeated or unsafe response cursor',()=>{
		for(const value of [{...page,data:Array(26).fill(row)},{...page,data:[row,row]},{...page,data:[{...row,assetCount:-1}]},{...page,data:[{...row,assetCount:'1'}]},{...page,data:[{...row,homeDomain:undefined}]},{...page,nextCursor:'x'.repeat(2049)},{...page,nextCursor:'+/='},{...page,data:[]},{...page,domainsReady:undefined}]) expect(()=>parseIssuerPage(value,null)).toThrow();
		expect(()=>parseIssuerPage(page,'page_2')).toThrow();
	});
});
