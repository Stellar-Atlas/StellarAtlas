import type express from 'express';

export function corsMiddleware(
	req: express.Request,
	res: express.Response,
	next: express.NextFunction
): void {
	res.header('Access-Control-Allow-Origin', '*');
	res.header(
		'Access-Control-Allow-Headers',
		'Origin, X-Requested-With, Content-Type, Accept, Authorization'
	);
	res.header(
		'Access-Control-Allow-Methods',
		'GET, POST, PUT, PATCH, DELETE, OPTIONS'
	);
	res.header('Access-Control-Expose-Headers', 'X-StellarAtlas-Inventory-Scope');
	if (req.method === 'OPTIONS') {
		res.sendStatus(204);
		return;
	}
	next();
}
