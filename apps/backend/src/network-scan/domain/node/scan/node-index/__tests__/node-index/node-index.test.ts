import { jest } from '@jest/globals';
import { ActiveIndex } from '../../index/active-index.js';
import { ValidatingIndex } from '../../index/validating-index.js';
import { AgeIndex } from '../../index/age-index.js';
import { TypeIndex } from '../../index/type-index.js';
import { TrustIndex } from '../../index/trust-index.js';
import { VersionIndex } from '../../index/version-index.js';
import { NodeIndex, IndexNode } from '../../node-index.js';
import { mock } from 'jest-mock-extended';
import { TrustGraph } from 'shared';

describe('NodeIndex', () => {
	test('calculateNodeIndex', () => {
		jest.spyOn(ActiveIndex, 'get').mockImplementation(() => 1);
		jest.spyOn(ValidatingIndex, 'get').mockImplementation(() => 0);

		jest.spyOn(AgeIndex, 'get').mockImplementation(() => 1);

		jest.spyOn(TypeIndex, 'get').mockImplementation(() => 0.101);
		jest.spyOn(TrustIndex, 'get').mockImplementation(() => 0.5);
		jest.spyOn(VersionIndex, 'get').mockImplementation(() => 1);

		const indexNode: IndexNode = {
			publicKey: 'publicKey',
			isActive30DaysPercentage: 100,
			hasUpToDateHistoryArchive: true,
			isValidating: true,
			stellarCoreVersion: 'stellarCoreVersion',
			dateDiscovered: new Date(),
			validating30DaysPercentage: 100
		};

		const trustGraph = mock<TrustGraph>();

		expect(
			NodeIndex.calculateIndexes([indexNode], trustGraph, 'v1.0.0')
		).toEqual(new Map([['publicKey', 60]]));
		jest.restoreAllMocks();
	});
});
