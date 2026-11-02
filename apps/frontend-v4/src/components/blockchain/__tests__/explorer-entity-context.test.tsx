import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.unstable_mockModule('../explorer-entity.module.css',()=>({default:{}}));
const {ExplorerEntityContext}=await import('../explorer-entity-context');
const {ExplorerEntityFilters}=await import('../explorer-entity-filters');
it('retains accepted source/range and API links without claiming complete coverage',()=>{
	const html=renderToStaticMarkup(createElement(ExplorerEntityContext,{collection:'operations',identifier:'429496729603',page:{entity:'operations',rows:[{sourceRecord:{batchId:'batch-id',digest:'a'.repeat(64),rowNumber:'9007199254740993'}}],limit:25,offset:0,nextOffset:null,window:{minLedger:99,maxLedger:101},coverage:{},coverageStatus:'partial_or_unknown',semantics:'Recorded parsed data'},submitted:{min_ledger:'99',max_ledger:'101'},elapsed:5,sourceRecord:true}));
	for(const text of ['Ledgers 99–101','incomplete or unknown coverage','Source batch','Source digest','9007199254740993','min_ledger=99','max_ledger=101','View API response'])expect(html).toContain(text);
		expect(html).not.toContain('Selected window fully published');
});
it('uses exact-operation request labels while preserving ordinary discovery controls',()=>{
	const props={collection:'operations' as const,identifier:'429496729603',filters:{min_ledger:'100',max_ledger:'100'},busy:false,onChange:()=>{},onApply:()=>{}};
	const operation=renderToStaticMarkup(createElement(ExplorerEntityFilters,{...props,operationDetail:true}));
	for(const text of ['Apply range','Use operation ledger','Reset request','Date &amp; ledger range'])expect(operation).toContain(text);
		expect(operation).not.toContain('Latest published');
		expect(renderToStaticMarkup(createElement(ExplorerEntityFilters,props))).toContain('Latest published');
});
