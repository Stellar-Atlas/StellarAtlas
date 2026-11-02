import { parseAssetReportPage } from '../explorer-asset-reports';
const page = {asset:'native', limit:25, data:[{account_id:'GA',balance:1.2345678,trust_line_limit:'9223372036854775807'}],nextCursor:'eyJ2IjoxfQ',coverageStatus:'complete',amountPrecision:'source-float64'};
describe('asset report page boundary', () => {
	it('preserves source amounts and integer strings and distinguishes empty partial history', () => {
		expect(parseAssetReportPage(page,'native')).toEqual({rows:page.data,next:page.nextCursor,complete:true});
		expect(parseAssetReportPage({...page,data:[],nextCursor:null,coverageStatus:'partial_or_unknown'},'native')).toEqual({rows:[],next:null,complete:false});
	});
	it('rejects wrong-asset, oversized or malformed pages and invalid continuation', () => {
		for(const value of [{...page,asset:'other'}, {...page,limit:100}, {...page,data:Array(26).fill({})}, {...page,data:[null]}, {...page,nextCursor:'x'.repeat(2049)}, {...page,coverageStatus:'unknown'}, {...page,amountPrecision:'exact'}]) expect(()=>parseAssetReportPage(value,'native')).toThrow();
	});
});
