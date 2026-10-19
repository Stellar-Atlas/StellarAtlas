import { operationInvocation } from '../explorer-operation-invocation';

const contract = `C${'A'.repeat(55)}`;
const alternateContract = `C${'B'.repeat(55)}`;

describe('operationInvocation', () => {
	it('prefers a valid JSON-decoded invocation', () => {
		expect(
			operationInvocation({
				type: 'invoke_host_function',
				details: {
					type: 'invoke_contract',
					contract_id: alternateContract,
					parameters_json_decoded: [
						{ address: contract },
						{ symbol: 'transfer' },
						{ arbitrary: 'decoded' }
					],
					parameters_decoded: [
						{ type: 'Address', value: alternateContract },
						{ type: 'Symbol', value: 'differentFunction' }
					]
				}
			})
		).toEqual({
			contractId: alternateContract,
			functionName: 'transfer',
			arguments: [{ arbitrary: 'decoded' }]
		});
	});

	it('falls back to typed decoded parameters and wraps supported arguments', () => {
		expect(
			operationInvocation({
				type: 'invoke_host_function',
				details: {
					type: 'invoke_contract',
					parameters_decoded: [
						{ type: 'Address', value: contract },
						{ type: 'Sym', value: 'swap' },
						{ type: 'Address', value: alternateContract },
						{ type: 'U64', value: '42' },
						{ type: 'Custom', value: 'kept' }
					],
					parameters: ['raw base64 must not be used']
				}
			})
		).toEqual({
			contractId: contract,
			functionName: 'swap',
			arguments: [
				{ address: alternateContract },
				{ u64: '42' },
				{ type: 'Custom', value: 'kept' }
			]
		});
	});

	it('requires full valid C-addresses and prefers the valid contract_id', () => {
		expect(
			operationInvocation({
				type: 'invoke_host_function',
				details: {
					type: 'invoke_contract',
					contract_id: 'CINVALID',
					parameters_json_decoded: [
						{ address: contract.slice(0, -1) },
						{ symbol: 'badAddress' }
					],
					parameters_decoded: [
						{ type: 'Address', value: contract },
						{ type: 'Symbol', value: 'validFallback' }
					]
				}
			})
		).toEqual({
			contractId: contract,
			functionName: 'validFallback',
			arguments: []
		});
	});

	it('returns null for non-invocations and malformed or unknown invocation data', () => {
		expect(operationInvocation({ type: 'payment', details: {} })).toBeNull();
		expect(
			operationInvocation({ type: 'invoke_host_function', details: null })
		).toBeNull();
		expect(
			operationInvocation({
				type: 'invoke_host_function',
				details: { type: 'create_contract', function: 'not-an-invocation-name' }
			})
		).toBeNull();
		expect(
			operationInvocation({
				type: 'invoke_host_function',
				details: {
					type: 'invoke_contract',
					parameters_decoded: [
						{ type: 'Address', value: 'G' + 'A'.repeat(55) },
						{ type: 'Symbol', value: '' }
					]
				}
			})
		).toBeNull();
	});
});
