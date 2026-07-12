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
	'cross-check',
	'domain',
	'dto',
	'env',
	'examples',
	'fbas',
	'federated-voting',
	'format',
	'history-scan-coordinator',
	'infrastructure',
	'migrations',
	'network-scan',
	'notifications',
	'overlay',
	'quorum',
	'simulation',
	'test-support',
	'trust-graph',
	'use-cases',
	'worker'
]);

const sourceAliasModuleNameMapper = {
	'^@crawler/(.*)\\.js$': '<rootDir>/../../packages/crawler/src/$1',
	'^@crawler/(.*)$': '<rootDir>/../../packages/crawler/src/$1',
	'^@network-observer/(.*)\\.js$':
		'<rootDir>/../../packages/crawler/src/network-observer/$1',
	'^@network-observer/(.*)$':
		'<rootDir>/../../packages/crawler/src/network-observer/$1',
	'^@utilities/(.*)\\.js$': '<rootDir>/../../packages/crawler/src/utilities/$1',
	'^@utilities/(.*)$': '<rootDir>/../../packages/crawler/src/utilities/$1',
	[`^@(${rootSourceAliases})/(.*)\\.js$`]: '<rootDir>/src/$2',
	[`^@(${rootSourceAliases})/(.*)$`]: '<rootDir>/src/$2',
	'^@fixtures/(.*)\\.js$': '<rootDir>/src/__fixtures__/$1',
	'^@fixtures/(.*)$': '<rootDir>/src/__fixtures__/$1',
	'^@mocks/(.*)\\.js$': '<rootDir>/src/__mocks__/$1',
	'^@mocks/(.*)$': '<rootDir>/src/__mocks__/$1',
	[`^@(${directorySourceAliases})/(.*)\\.js$`]: '<rootDir>/src/$1/$2',
	[`^@(${directorySourceAliases})/(.*)$`]: '<rootDir>/src/$1/$2'
};

const workspacePackageSourceMapper = {
	'^crawler$': '<rootDir>/../../packages/crawler/src/index.ts',
	'^custom-error$': '<rootDir>/../../packages/custom-error/src/index.ts',
	'^exception-logger$':
		'<rootDir>/../../packages/exception-logger/src/index.ts',
	'^history-scanner-dto$':
		'<rootDir>/../../packages/history-scanner-dto/src/index.ts',
	'^http-helper$': '<rootDir>/../../packages/http-helper/src/index.ts',
	'^job-monitor$': '<rootDir>/../../packages/job-monitor/src/index.ts',
	'^logger$': '<rootDir>/../../packages/logger/src/index.ts',
	'^node-connector$': '<rootDir>/../../packages/node-connector/src/index.ts',
	'^scp-simulation$': '<rootDir>/../../packages/scp-simulation/src/index.ts',
	'^shared$': '<rootDir>/../../packages/shared/src/index.ts',
	'^stellar-halting-analysis$':
		'<rootDir>/../../packages/stellar-halting-analysis/src/index.ts'
};

const project = (config) => ({
	...esModuleDependencyTransform,
	setupFilesAfterEnv: ['<rootDir>/../../jest.setup.mjs'],
	...config,
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
		...sourceAliasModuleNameMapper,
		...workspacePackageSourceMapper,
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
			moduleDirectories: ['node_modules'],
			testMatch: [
				'**/__tests__/**/*.(integration|test).(js|jsx|ts|tsx)',
				'**/?(*.)+(spec|test).(js|jsx|ts|tsx)'
			]
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
