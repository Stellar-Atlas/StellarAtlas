import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
import { parseBalanceFlagEvidence } from '../../../api/balance-flag-evidence';
jest.unstable_mockModule('../explorer-entity.module.css',()=>({default:{}}));
const {ObservedBalanceFlags}=await import('../explorer-balance-flags');
const markup=(asset:string,type:unknown,flags:unknown)=>renderToStaticMarkup(createElement(ObservedBalanceFlags,{evidence:parseBalanceFlagEvidence(asset,type,flags)}));

describe('observed authorization disclosure',()=>{
	it('shows concise classic state, separate clawback and accessible original flags',()=>{
		const html=markup('USD:GA','credit_alphanum4',6);
		expect(html).toContain('<summary>Liabilities only · observed');expect(html).toContain('Clawback enabled');
		expect(html).toContain('Raw flags: 6 (0x6)');expect(html).toContain('not current spendability');
		expect(html).not.toContain('<details open');
	});
	it('uses issuer-policy language on native rows, not a transfer lock',()=>{
		const html=markup('native','native',4);
		expect(html).toContain('Account policy · observed');expect(html).toContain('Issuer authorization immutable');
		expect(html).toContain('not XLM transfer authorization');expect(html).not.toContain('Clawback enabled');expect(html).not.toContain('Not authorized');
	});
	it('retains unknown and unavailable states instead of displaying authorized defaults',()=>{
		expect(markup('USD:GA','credit_alphanum4',9)).toContain('Authorization unknown');
		expect(markup('USD:GA','credit_alphanum4',9)).toContain('Unknown flag bits: 8 (0x8)');
		expect(markup('USD:GA','credit_alphanum4',9)).toContain('Known flag bits:');
		expect(markup('USD:GA','credit_alphanum4',3)).toContain('Both authorization bits');
		expect(markup('USD:GA','credit_alphanum4','1')).toContain('Flag details unavailable');
		expect(markup('native',undefined,3)).toContain('Flag details not recorded');
		expect(markup('native',undefined,3)).not.toContain('Both authorization bits');
	});
});
