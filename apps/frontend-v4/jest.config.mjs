export default {
	extensionsToTreatAsEsm: ['.ts', '.tsx'],
	rootDir: '.',
	testEnvironment: 'node',
	testMatch: [
		'<rootDir>/src/**/__tests__/**/*.test.ts',
		'<rootDir>/src/**/__tests__/**/*.test.tsx'
	],
	moduleNameMapper: {
		'^@(api|app|components|domain|format)/(.*)$': '<rootDir>/src/$1/$2'
	},
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
