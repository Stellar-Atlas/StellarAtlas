import eslintJs from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';
import vueTsEslintConfig from '@vue/eslint-config-typescript';

const tsFiles = ['**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx,vue}'];

const customTypescriptConfig = {
	files: tsFiles,
	rules: {
		'@typescript-eslint/prefer-for-of': 'off',
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/ban-ts-comment': 'off',
		'@typescript-eslint/explicit-module-boundary-types': 'off',
		'@typescript-eslint/no-unused-vars': 'off',
		'@typescript-eslint/no-require-imports': 'off',
		'@typescript-eslint/no-empty-function': 'off',
		'vue/multi-word-component-names': 'off',
		'vue/no-v-html': 'off',
		'no-require-imports': 'off',
		'no-undef': 'off'
	}
};

export default [
	{
		ignores: [
			'.codex/**',
			'**/.fallow/**',
			'**/.next*/**',
			'**/dist/**',
			'**/history-bucket-cache/**',
			'**/lib/**',
			'**/local-ops/**',
			'**/server-lib/**',
			'apps/frontend-v3/**',
			'coverage/**',
			'external-reference/**',
			'node_modules/**'
		]
	},
	eslintJs.configs.recommended,
	...pluginVue.configs['flat/vue2-recommended'],
	...vueTsEslintConfig(),
	skipFormatting,
	customTypescriptConfig
];
