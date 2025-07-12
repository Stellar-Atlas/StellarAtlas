#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

const LOGFILE = 'api.log';
if (fs.existsSync(LOGFILE)) fs.unlinkSync(LOGFILE);

const api = spawn('pnpm', ['start:api']);
const apiLog = fs.createWriteStream(LOGFILE, { flags: 'a' });

api.stdout.on('data', (data) => {
  process.stdout.write(`[api] ${data}`);
  apiLog.write(data);
});
api.stderr.on('data', (data) => {
  process.stderr.write(`[api] ${data}`);
  apiLog.write(data);
});

function waitForApi() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (fs.readFileSync(LOGFILE, 'utf8').includes('api listening on port:')) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

(async () => {
  console.log('Waiting for API to be ready...');
  await waitForApi();
  console.log('API is up. Starting other services with colored logs...');
  const concurrently = spawn('pnpm', [
    'concurrently',
    '-n',
    'frontend,network,history,users',
    '-c',
    'blue,green,magenta,cyan',
    'pnpm start:frontend',
    'pnpm start:scan-network',
    'pnpm start:scan-history',
    'pnpm start:users',
  ], { stdio: 'inherit' });

  concurrently.on('exit', (code) => {
    process.exit(code);
  });

  api.on('exit', (code) => {
    process.exit(code);
  });
})();
