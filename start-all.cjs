#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { delimiter, join } = require('node:path');

const preferredNode = '/home/observe/.nvm/versions/node/v26.4.0/bin/node';
const preferredNodePath = '/home/observe/.nvm/versions/node/v26.4.0/bin';
const nodeBin = existsSync(preferredNode) ? preferredNode : process.execPath;
const scriptPath = join(
	__dirname,
	'apps/backend/lib/core/infrastructure/cli/start-all.js'
);

function buildPath() {
	const existingPath = process.env.PATH ?? '';
	return [preferredNodePath, existingPath]
		.filter((entry) => entry.length > 0)
		.join(delimiter);
}

const child = spawn(nodeBin, [scriptPath], {
	env: {
		...process.env,
		PATH: buildPath()
	},
	stdio: 'inherit'
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});

child.on('error', (error) => {
	console.error(error);
	process.exit(1);
});
