import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
jest.unstable_mockModule('../explorer-entity.module.css',()=>({default:{}}));
jest.unstable_mockModule('../explorer-investigation',()=>({ExplorerLink:({href,children}:{href:string;children:React.ReactNode})=>createElement('a',{href},children)}));
const { ExplorerTransferTable } = await import('../explorer-transfer-table');
const ga='G'+'A'.repeat(55), contract='C'+'A'.repeat(55);
const row={id:'one',ledgerSequence:100,closedAt:'2026-11-02T00:00:00Z',transactionHash:'a'.repeat(64),transactionId:'429496729600',operationId:'429496729601',from:ga,to:contract,toMuxed:null,asset:{id:'USD:'+ga,type:'credit_alphanum4',code:'USD',issuer:ga},contractId:contract,eventTopic:'transfer',amountRaw:'9007199254740993123',amountScale:7};
it('renders exact values, full linked identities, mobile labels and optional raw details',()=>{
	const html=renderToStaticMarkup(createElement(ExplorerTransferTable,{rows:[row,{...row,id:'two',amountScale:null,asset:{id:contract,type:'contract',code:null,issuer:null}}]}));
	for(const label of ['Asset / amount','From','To','Details']) expect(html).toContain('data-label="'+label+'"');
	for(const value of [ga,contract,'900719925474.0993123','9007199254740993123 raw units','Decimals not recorded','Transfer details','/explorer/operations/429496729601?min_ledger=100&amp;max_ledger=100']) expect(html).toContain(value);
		expect(html).not.toContain('<details open');expect(html).not.toContain('…');
});
