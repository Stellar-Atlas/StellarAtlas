import { HomeDomainFetcher } from '../../domain/node/scan/HomeDomainFetcher.js';
import { HorizonService } from '../../domain/network/scan/HorizonService.js';
// noinspection JSIgnoredPromiseFromCall
import { getConfigFromEnv } from '../../../core/config/Config.js';
import { PinoLogger } from 'logger';
import { AxiosHttpService } from 'http-helper';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);

main();

async function main() {
	if (process.argv.length <= 2) {
		console.log('Usage: ' + currentFile + ' PUBLIC KEY');

		process.exit(-1);
	}
	const publicKey = process.argv[2];

	const configResult = getConfigFromEnv();
	if (configResult.isErr()) {
		console.log(configResult.error.message);
		return;
	}

	const horizonService = new HorizonService(
		new AxiosHttpService('test'),
		configResult.value.horizonUrl
	);
	const homeDomainUpdater = new HomeDomainFetcher(
		horizonService,
		new PinoLogger()
	);

	const domainResult = await homeDomainUpdater.fetchDomain(publicKey);
	if (domainResult.isOk()) console.log(domainResult.value);
	else console.log(domainResult.error.message);
}
