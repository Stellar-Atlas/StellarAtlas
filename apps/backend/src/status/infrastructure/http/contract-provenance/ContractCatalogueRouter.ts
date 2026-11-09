import express, { type Router } from 'express';
import { readCatalogueQuery } from './ContractCatalogue.js';
import type { ContractCatalogueStore } from './ContractCatalogueStore.js';

export function contractCatalogueRouter(
	networkPassphrase: string,
	store?: Pick<ContractCatalogueStore, 'list'>
): Router {
	const router = express.Router();
	let active = 0;
	router.get('/contracts/catalogue', async (request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		const query = readCatalogueQuery(request.query, networkPassphrase);
		if (!query)
			return response
				.status(400)
				.json({ code: 'invalid_contract_catalogue_query' });
		if (!store || active >= 4)
			return response
				.status(503)
				.json({ code: 'contract_catalogue_unavailable' });
		active++;
		try {
			return response.json(await store.list(query));
		} catch {
			return response
				.status(503)
				.json({ code: 'contract_catalogue_unavailable' });
		} finally {
			active--;
		}
	});
	return router;
}
