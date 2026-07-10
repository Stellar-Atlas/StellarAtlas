export default {
	extensionsToTreatAsEsm: ['.ts', '.tsx'],
	rootDir: '.',
	testEnvironment: 'node',
	testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				tsconfig: '<rootDir>/tsconfig.json',
				useESM: true
			}
		]
	}
};
