import { Networks } from '@stellar/stellar-sdk';
import express, { type Router } from 'express';
import { exactDomainName } from './SorobanDomainRecord.js';
import {
	SorobanDomainBusy,
	SorobanDomainResolver
} from './SorobanDomainResolver.js';

export function sorobanDomainRouter(config: {
	readonly rpcUrl?: string;
	readonly networkPassphrase: string;
}): Router {
	const router = express.Router();
	const mainnet = config.networkPassphrase === Networks.PUBLIC;
	const resolver =
		mainnet && config.rpcUrl
			? new SorobanDomainResolver(new URL(config.rpcUrl))
			: undefined;

	router.get('/soroban-domains/:name', async (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		const domain = exactDomainName(request.params.name ?? '');
		if (!domain) {
			response.status(400).json({
				code: 'invalid_soroban_domain',
				error:
					'Enter an exact .xlm name with one to four alphabetic labels of at most 15 letters each'
			});
			return;
		}
		if (!mainnet) {
			response.status(404).json({
				code: 'soroban_domains_unsupported_network',
				error: 'This Soroban Domains registry is available on mainnet'
			});
			return;
		}
		try {
			if (!resolver) throw new Error('Registry RPC is unconfigured');
			response.json(await resolver.resolve(domain));
		} catch (error) {
			const busy = error instanceof SorobanDomainBusy;
			if (busy) response.setHeader('Retry-After', '5');
			response.status(503).json({
				code: busy ? 'soroban_domain_busy' : 'soroban_domain_unavailable',
				error: busy
					? 'Domain lookup is busy'
					: 'Domain lookup is temporarily unavailable'
			});
		}
	});
	return router;
}
