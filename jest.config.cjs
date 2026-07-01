const esModuleDependencyTransform = {
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
		'^.+\\.m?js$': [
			'babel-jest',
			{
				presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
			}
		]
	},
	transformIgnorePatterns: [
		'/node_modules/(?!.*(@noble[\\\\/](hashes|ed25519)|uint8array-extras)/)'
	]
};

const project = (config) => ({
	...esModuleDependencyTransform,
	...config,
	transform: {
		...esModuleDependencyTransform.transform,
		...(config.transform ?? {})
	}
});

module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	...esModuleDependencyTransform,
	globals: {
		'ts-jest': {
			tsconfig: 'tsconfig.json'
		}
	},
	projects: [
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'backend',
			rootDir: 'apps/backend',
			moduleDirectories: ['node_modules']
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'history-scanner',
			rootDir: 'apps/history-scanner'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'history-scanner-dto',
			rootDir: 'packages/history-scanner-dto'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'crawler',
			rootDir: 'packages/crawler'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'shared',
			rootDir: 'packages/shared'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'scp-simulation',
			rootDir: 'packages/scp-simulation'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'http-helper',
			rootDir: 'packages/http-helper'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'logger',
			rootDir: 'packages/logger'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'job-monitor',
			rootDir: 'packages/job-monitor'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'exception-logger',
			rootDir: 'packages/exception-logger'
		}),
		project({
			testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/lib'],
			preset: 'ts-jest',
			displayName: 'node-connector',
			rootDir: 'packages/node-connector'
		}),
		project({
			moduleFileExtensions: ['js', 'jsx', 'json', 'vue', 'ts', 'tsx'],
			preset: 'ts-jest',
			displayName: 'frontend',
			rootDir: 'apps/frontend',
			moduleNameMapper: {
				'^@/(.*)$': '<rootDir>/src/$1'
			},
			testMatch: ['**/__tests__/**/*.test.(js|jsx|ts|tsx)'],
			testEnvironmentOptions: {
				url: 'http://localhost/'
			}
		})
	]
};
