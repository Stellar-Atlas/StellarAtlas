import { parseBalanceFlagEvidence, describeBalanceFlags } from '../balance-flag-evidence';

describe('observed account and trustline flag evidence', () => {
	it('keeps every classic authorization combination distinct from clawback', () => {
		const labels = ['Not authorized · observed', 'Authorized · observed', 'Liabilities only · observed', 'Authorization unknown'];
		for (const assetType of ['credit_alphanum4', 'credit_alphanum12']) for (let flags=0;flags<8;flags++) {
			const evidence = parseBalanceFlagEvidence('USD:GA',assetType,flags);
			expect(evidence).toEqual({assetType,flags,flagStatus:'recorded'});
			expect(describeBalanceFlags(evidence)).toMatchObject({label:labels[flags&3],clawback:!!(flags&4),unknownBits:0});
		}
	});
	it('never treats native account policy as trustline authorization or XLM clawback', () => {
		for(let flags=0;flags<16;flags++) {
			const description = describeBalanceFlags(parseBalanceFlagEvidence('native','native',flags));
			expect(description.label).toBe('Account policy · observed');
			expect(description.clawback).toBe(false);
			expect(description.context).toContain('not XLM transfer authorization');
		}
		expect(describeBalanceFlags(parseBalanceFlagEvidence('native','native',4)).known).toEqual(['Issuer authorization immutable']);
		expect(describeBalanceFlags(parseBalanceFlagEvidence('native','native',8)).known).toEqual(['Issuer clawback enabled']);
	});
	it('preserves unknown UInt32 bits without signed wrapping or claiming authorization', () => {
		for(const flags of [8,9,2147483648,4294967295]) {
			const evidence = parseBalanceFlagEvidence('USD:GA','credit_alphanum4',flags);
			expect(evidence.flags).toBe(flags);
			expect(describeBalanceFlags(evidence)).toMatchObject({label:'Authorization unknown',unknownBits:flags-(flags&7)});
		}
		expect(describeBalanceFlags(parseBalanceFlagEvidence('native','native',16))).toMatchObject({label:'Account policy unknown',unknownBits:16});
	});
	it('does not coerce or authorize missing, malformed or inconsistent metadata', () => {
		for(const flags of ['1',null,true,NaN,Infinity,-1,-0,1.5,4294967296,9007199254740992,{}]) {
			const evidence = parseBalanceFlagEvidence('USD:GA','credit_alphanum4',flags);
			expect(evidence.flagStatus).toBe('invalid');expect(evidence.flags).toBeUndefined();
			expect(describeBalanceFlags(evidence).label).toBe('Flag details unavailable');
		}
		for(const [asset,assetType,flags] of [['native','credit_alphanum4',1],['USD:GA','native',1],['USD:GA','pool_share',1]] as const) expect(parseBalanceFlagEvidence(asset,assetType,flags).flagStatus).toBe('invalid');
		for(const evidence of [parseBalanceFlagEvidence('native',undefined,1),parseBalanceFlagEvidence('USD:GA','credit_alphanum4',undefined),{}]) expect(describeBalanceFlags(evidence).label).toBe('Flag details not recorded');
		expect(describeBalanceFlags(parseBalanceFlagEvidence('native',undefined,1)).known).toEqual([]);
	});
});
