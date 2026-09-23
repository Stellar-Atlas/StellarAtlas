'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';

// Native request playground: no proxy, no automatic data queries or ambient credentials.
export const DocsOpenApiPage = createOpenAPIPage({
	showResponseSchema: true,
	storageKeyPrefix: 'stellaratlas-public-api-',
	playground: {
		fetchOptions: {
			requestTimeout: 20,
			proxyForwardCookie: false,
			onRequestInit: (request) => ({ ...request, credentials: 'omit' })
		}
	}
});
