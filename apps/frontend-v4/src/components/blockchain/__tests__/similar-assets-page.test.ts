import { isClassicComparisonAsset, readSimilarCursor, similarAssetsHref, similarAssetsPath, parseSimilarAssetsPage, similarAssetSourceHref } from '../similar-assets-page';
const asset='USD:'+'G'+'A'.repeat(55),other='G'+'B'.repeat(55);
const row={id:'USD:'+other,kind:'classic',code:'USD',issuer:other,source:'https://example.org/project'};
const page={asset:{id:asset},data:[row],nextCursor:'next_page',generatedAt:'2026-11-02T00:00:00Z'};
describe('scoped same-symbol asset comparison',()=>{
	it('roundtrips only its own cursor and preserves tabs/investigation context',()=>{
		const url=new URL(similarAssetsHref('/explorer/assets/'+encodeURIComponent(asset),'?tab=same-symbol&return_to=%2Fexplorer',asset,'next_page','#compare'),'http://fixture.invalid');
		expect(readSimilarCursor(url.searchParams,asset)).toBe('next_page');expect(url.searchParams.get('tab')).toBe('same-symbol');expect(url.searchParams.get('return_to')).toBe('/explorer');expect(url.hash).toBe('#compare');
		expect(()=>readSimilarCursor(url.searchParams,'EUR:'+other)).toThrow();
		expect(similarAssetsPath(asset,null)).toBe('/v1/assets/'+encodeURIComponent(asset)+'/similar?limit=25');
		for(const value of ['native','C'+'A'.repeat(55)])expect(isClassicComparisonAsset(value)).toBe(false);
	});
	it('rejects malformed continuation and oversized/foreign/duplicate/symbol-mismatch data',()=>{
		for(const value of [{...page,asset:{id:'other'}},{...page,data:Array(26).fill(row)},{...page,data:[row,row]},{...page,data:[{...row,code:'EUR'}]},{...page,nextCursor:'x'.repeat(2049)}])expect(()=>parseSimilarAssetsPage(value,asset,null)).toThrow();
		expect(()=>parseSimilarAssetsPage(page,asset,'next_page')).toThrow();
		for(const query of ['similar_after=next','similar_for=other','similar_after=a&similar_after=b&similar_for='+encodeURIComponent(asset)])expect(()=>readSimilarCursor(new URLSearchParams(query),asset)).toThrow();
	});
	it('allows an empty intermediate page and preserves reference attribution without inferring authenticity',()=>{
		expect(parseSimilarAssetsPage(page,asset,null).rows[0]?.source).toBe(row.source);
		expect(parseSimilarAssetsPage({...page,data:[]},asset,null)).toEqual({rows:[],next:'next_page',generatedAt:page.generatedAt});
		expect(parseSimilarAssetsPage({...page,data:[],nextCursor:null,generatedAt:null},asset,null).generatedAt).toBeNull();
		for(const source of ['javascript:alert(1)','data:text/html,hello','https://name:secret@example.org/'])expect(similarAssetSourceHref(source)).toBeNull();
		expect(similarAssetSourceHref(row.source)).toBe(row.source);
	});
});
