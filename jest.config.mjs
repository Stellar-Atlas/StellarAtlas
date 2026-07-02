const esModuleDependencyTransform = {
	extensionsToTreatAsEsm: ['.ts', '.tsx'],
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				tsconfig: '<rootDir>/tsconfig.json',
				useESM: true
			}
		],
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

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliasPattern = (aliases) => aliases.map(escapeRegExp).join('|');

const rootSourceAliases = aliasPattern([
	'backend',
	'crawler',
	'custom-error',
	'exception-logger',
	'history-scanner',
	'history-scanner-dto',
	'http-helper',
	'job-monitor',
	'logger',
	'node-connector',
	'scp-simulation',
	'shared',
	'stellar-halting-analysis',
	'users'
]);

const directorySourceAliases = aliasPattern([
	'api',
	'app',
	'components',
	'connection',
	'console-interface',
	'core',
	'domain',
	'dto',
	'env',
	'examples',
	'federated-voting',
	'format',
	'history-scan-coordinator',
	'infrastructure',
	'migrations',
	'network-observer',
	'network-scan',
	'notifications',
	'overlay',
	'quorum',
	'simulation',
	'trust-graph',
	'use-cases',
	'utilities',
	'worker'
]);

const sourceAliasModuleNameMapper = {
	[`^@(${rootSourceAliases})/(.*)\\.js$`]: '<rootDir>/src/$2',
	[`^@(${rootSourceAliases})/(.*)$`]: '<rootDir>/src/$2',
	'^@fixtures/(.*)\\.js$': '<rootDir>/src/__fixtures__/$1',
	'^@fixtures/(.*)$': '<rootDir>/src/__fixtures__/$1',
	'^@mocks/(.*)\\.js$': '<rootDir>/src/__mocks__/$1',
	'^@mocks/(.*)$': '<rootDir>/src/__mocks__/$1',
	[`^@(${directorySourceAliases})/(.*)\\.js$`]:
		'<rootDir>/src/$1/$2',
	[`^@(${directorySourceAliases})/(.*)$`]: '<rootDir>/src/$1/$2'
};

const project = (config) => ({
	...esModuleDependencyTransform,
	setupFilesAfterEnv: ['<rootDir>/../../jest.setup.mjs'],
	...config,
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
		...sourceAliasModuleNameMapper,
		...(config.moduleNameMapper ?? {})
	},
	transform: {
		...esModuleDependencyTransform.transform,
		...(config.transform ?? {})
	}
});

export default {
	preset: 'ts-jest',
	testEnvironment: 'node',
	...esModuleDependencyTransform,
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
