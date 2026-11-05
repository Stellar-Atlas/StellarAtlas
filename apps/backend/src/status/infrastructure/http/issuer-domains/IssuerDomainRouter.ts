import express, { type Router } from 'express';
import { normalizeIssuerDomain } from './IssuerDomainCache.js';
import {
	IssuerDomainBusy,
	type IssuerDomainLookup
} from './IssuerDomainLookup.js';

export function issuerDomainRouter(
	networkPassphrase: string,
	lookup: Pick<IssuerDomainLookup, 'lookup'>
): Router {
	const router = express.Router();
	router.get('/issuer-domains/:domain', async (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		const raw = request.params.domain ?? '';
		const domain = raw.length <= 254 ? normalizeIssuerDomain(raw) : null;
		if (!domain) {
			response.status(400).json({
				code: 'invalid_issuer_domain',
				error: 'Enter an exact issuer DNS hostname'
			});
			return;
		}
		try {
			response.json({ networkPassphrase, ...(await lookup.lookup(domain)) });
		} catch (error) {
			if (error instanceof IssuerDomainBusy)
				response.setHeader('Retry-After', '5');
			response.status(503).json({
				code: 'issuer_domain_evidence_unavailable',
				error: 'Issuer domain evidence is temporarily unavailable'
			});
		}
	});
	return router;
}
