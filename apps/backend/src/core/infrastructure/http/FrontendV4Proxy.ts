import type { NextFunction, Request, Response } from 'express';

const previewPathPattern = /^\/new-ui(?:\/|$)/;
const defaultFrontendV4Origin = 'http://127.0.0.1:3104';

function frontendV4PreviewEnabled(): boolean {
	if (process.env.DISABLE_FRONTEND_V4_PREVIEW === '1') return false;
	return process.env.ENABLE_FRONTEND_V4_PREVIEW !== '0';
}

function getFrontendV4Origin(): string {
	return process.env.FRONTEND_V4_ORIGIN ?? defaultFrontendV4Origin;
}

async function proxyFrontendV4(req: Request, res: Response): Promise<void> {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.status(405).send('Method Not Allowed');
		return;
	}

	const targetUrl = new URL(req.originalUrl, getFrontendV4Origin());
	const response = await fetch(targetUrl, {
		headers: {
			accept: req.get('accept') ?? '*/*',
			'user-agent': req.get('user-agent') ?? 'stellaratlas-preview-proxy'
		},
		method: req.method
	});

	res.status(response.status);
	for (const headerName of ['cache-control', 'content-type', 'location']) {
		const headerValue = response.headers.get(headerName);
		if (headerValue) res.setHeader(headerName, headerValue);
	}

	if (req.method === 'HEAD') {
		res.end();
		return;
	}

	res.send(Buffer.from(await response.arrayBuffer()));
}

export function frontendV4ProxyMiddleware(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	if (!previewPathPattern.test(req.originalUrl) || !frontendV4PreviewEnabled()) {
		next();
		return;
	}

	proxyFrontendV4(req, res).catch((error) => {
		const message = error instanceof Error ? error.message : 'Proxy failed';
		res.status(502).send(`Frontend v4 preview unavailable: ${message}`);
	});
}
