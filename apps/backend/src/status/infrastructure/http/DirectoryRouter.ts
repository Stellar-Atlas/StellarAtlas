import express, { type Request, type Response, type Router } from 'express';
import {
	DirectoryInputError,
	type DirectoryReader
} from '../directory/DirectoryReader.js';

export const directoryRoutePrefix = '/v1/account-directory';

export function directoryRouter(reader: DirectoryReader): Router {
	const router = express.Router();
	router.get('/', (request, response) =>
		send(response, () =>
			reader.search(
				network(request),
				request.query.q,
				request.query.cursor,
				request.query.limit
			)
		)
	);
	router.get('/:address', (request, response) =>
		send(response, () =>
			reader.lookup(network(request), request.params.address ?? '')
		)
	);
	return router;
}

function network(request: Request) {
	const value = request.query.network;
	if (value !== 'mainnet' && value !== 'testnet')
		throw new DirectoryInputError('Use network mainnet or testnet');
	return value;
}

async function send(
	response: Response,
	read: () => Promise<unknown>
): Promise<void> {
	response.setHeader('Cache-Control', 'no-store');
	try {
		response.json(await read());
	} catch (error) {
		if (error instanceof DirectoryInputError) {
			response
				.status(400)
				.json({ code: 'invalid_directory_input', error: error.message });
		} else {
			response.status(503).json({
				code: 'directory_unavailable',
				error: 'Account directory is temporarily unavailable'
			});
		}
	}
}
